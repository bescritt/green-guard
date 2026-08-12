import * as BDTLL from "../../../BDTLLCommon";
import { DataExtractor, FacebookDataExtractor, IMessageExtractionConfig } from "../BDTLL_ChatProtection";
import { LocaleTimestampParser } from "./localeTimestampParser";

const MessageContentSelectors: string[] = [
    ":scope > div:not([role='presentation']) div[role='presentation'] > span[dir='auto']",
    ":scope div[role='presentation'] > span[dir='auto']"
];
const MessageTooltipHookSelectors: string[] = [
    ":scope > div:not([role='presentation']) div[role='presentation'] > span[dir='auto'] > div:last-child",
    ":scope div[role='presentation'] > span[dir='auto'] > div:last-child"
];
const ConversationNameSelectors: string[] = [
	"div[role='main'] h1[dir='auto'] span.html-span",
	"div[role='main'] h1",
	"div[role='main'] h2[dir='auto'] span.html-span",
	"div[role='main'] h2",
	"div[role='main'] h3[dir='auto'] span.html-span",
	"div[role='main'] h3",
	"div[role='main'] h4[dir='auto'] span.html-span",
	"div[role='main'] h4",
	"div[role='main'] h5[dir='auto'] span.html-span",
	"div[role='main'] h5",
	"div[role='main'] h6[dir='auto'] span.html-span",
	"div[role='main'] h6"
];
const UserResponseSelectors: string[] = [
    "div[role='main'] div[data-scope='messages_table'] div.html-div:nth-child(5)"
];
const RootMessageSelectors: string[] = [
    "div[role='main'] div[data-scope='messages_table']"
];
const UnknownContactSelectors: string[] = [
    "div[role='main'] div[role='none'][tabIndex='-1'] div[role='alert']"
];
const GroupChatIndicatorSelectors: string[] = [
    "div[role='main'] div[data-visualcompletion='ignore-dynamic'] > div:first-child > div:nth-child(2)"
];
const GroupChatSenderSelectors: string[] = [
    "h1 > div > div > span[dir]",
    "h2 > div > div > span[dir]",
    "h3 > div > div > span[dir]",
    "h4 > div > div > span[dir]",
    "h5 > div > div > span[dir]",
    "h6 > div > div > span[dir]"
];
const TimestampSelectors: string[] = [
	"[data-scope='date_break']"
];

enum ReactPropsExtractorErrors {
    MissingElement = 1,
    MissingTimestamp = 2,
    Unknown = 3
}

export class MessengerDataExtractor extends DataExtractor {
	private static lastFacebookTimestamp: number | null = null;
    private static timestampCache: Map<string, number> = new Map();
    private static requestIdCounter: number = 0;
    private static pendingRequests: Map<string, {
        resolve: (value: number) => void,
        reject: (reason?: any) => void
    }> = new Map();

    constructor(chatProtectionSettings: BDTLL.IChatProtectionSettings, target: HTMLElement = document.body) {
        super(BDTLL.ChatPlatform.FB_MESSENGER, chatProtectionSettings, target);
        MessengerDataExtractor.addMessageListener();
    }

    async extractConversationData(): Promise<void> {
        this.conversationName = (this.targetElement.querySelector(ConversationNameSelectors.join()) as HTMLElement)?.innerText;
        this.knownContact = this.targetElement.querySelector(UnknownContactSelectors.join()) === null;
        this.isGroupChat = this.targetElement.querySelector(GroupChatIndicatorSelectors.join()) !== null;

        await super.extractMessages({
            RootMessageSelectors: RootMessageSelectors.join(),
            MessageContentSelectors: MessageContentSelectors.join(),
            MessageTooltipHookSelectors: MessageTooltipHookSelectors.join(),
            GeneralGroupChatSenderSelectors: GroupChatSenderSelectors.join(),
            UserResponseSelectors: UserResponseSelectors.join(),
            isUserResponse: FacebookDataExtractor.isUserResponse,
            extractTimestamp: MessengerDataExtractor.extractTimestamp
        });
    }

    static addMessageListener(): void {
        if ((window as { ___BDTLL_TIMESTAMP_EXTRACTOR_FLAG___?: boolean }).___BDTLL_TIMESTAMP_EXTRACTOR_FLAG___) {
            return;
        }

        (window as { ___BDTLL_TIMESTAMP_EXTRACTOR_FLAG___?: boolean }).___BDTLL_TIMESTAMP_EXTRACTOR_FLAG___ = true;
        window.addEventListener('message', MessengerDataExtractor.handleWindowMessage);
    }

    static handleWindowMessage(event: MessageEvent): void {
        if (event.source !== window) {
            return;
        }

        const payload: unknown = event.data;
        if (!payload || typeof payload !== "object") {
            return;
        }

        const payloadType: string | undefined = (payload as { type?: string }).type;
        if (payloadType !== "BDTLL_TIMESTAMP_RESPONSE") {
            return;
        }

        const elementId: unknown = (payload as { elementId?: unknown }).elementId;
        if (typeof elementId !== "string") {
            return;
        }

        const element: HTMLElement | null = document.querySelector(`[data-bdtll-timestamp-id="${elementId}"]`);
        const promiseHandlers = MessengerDataExtractor.pendingRequests.get(elementId);

        if (!promiseHandlers) {
            // duplicate timestamp request, the response has already been handled
            return;
        }

        const errorMessage: unknown = (payload as { error?: unknown }).error;
        if (typeof errorMessage === "string") {
            MessengerDataExtractor.pendingRequests.delete(elementId);
            promiseHandlers.reject(new Error(errorMessage));

            if ((payload as { errorCode?: unknown }).errorCode === ReactPropsExtractorErrors.MissingElement) {
                // messenger often re-renders elements, by the time the request reached the extractor script
                // it is possible that the message element re-rendered without the id specified
                return;
            }
            return;
        }

        if (!element) {
            MessengerDataExtractor.pendingRequests.delete(elementId);
            promiseHandlers.reject(new Error(`MessengerDataExtractor: no element found for id ${elementId}`));
            return;
        }

        const timestamp: unknown = (payload as { timestamp?: unknown }).timestamp;
        if (typeof timestamp !== "number") {
            MessengerDataExtractor.pendingRequests.delete(elementId);
            promiseHandlers.reject(new Error(`MessengerDataExtractor: invalid timestamp for id ${elementId}`));
            return;
        }

        MessengerDataExtractor.timestampCache.set(elementId, timestamp);
        MessengerDataExtractor.pendingRequests.delete(elementId);
        promiseHandlers.resolve(timestamp);
    }

    static async extractTimestamp(message: HTMLElement): Promise<number> {
		if ((new URL(document.location.href)).hostname === BDTLL.ChatPlatform.FACEBOOK as string) {
			const timestampText: string = message.querySelector(TimestampSelectors.join())?.textContent?.trim() ?? '';
			if (!timestampText) {
				if (MessengerDataExtractor.lastFacebookTimestamp === null) {
					return Date.now();
				}
				return MessengerDataExtractor.lastFacebookTimestamp;
			}

			const parsedTimestamp: number = LocaleTimestampParser.parse(timestampText);
			MessengerDataExtractor.lastFacebookTimestamp = parsedTimestamp;

			return parsedTimestamp;
		}

        const tooltipHook: HTMLElement | null = message.querySelector(MessageTooltipHookSelectors.join());
        const contentElement: HTMLElement | null = message.querySelector(MessageContentSelectors.join());
        const contentText: string = contentElement?.textContent?.trim() ?? "";
        const isImageOnlyMessage: boolean = contentText.length === 0 &&
            (contentElement?.querySelector("img") !== null);

        if (!tooltipHook && !contentElement) {
            // system messages and other non-message rows are also caught by RootMessageSelectors
            return Date.now();
        }

        if (isImageOnlyMessage) {
            return Date.now();
        }

        let elementId: string = message.getAttribute('data-bdtll-timestamp-id');
        if (elementId !== null) {
            const cachedTimestamp: number = MessengerDataExtractor.timestampCache.get(elementId);
            if (cachedTimestamp !== undefined) {
                return cachedTimestamp;
            }

            const existingRequest = MessengerDataExtractor.pendingRequests.get(elementId);
            if (existingRequest !== undefined) {
                return new Promise<number>((resolve, reject) => {
                    const checkInterval = setInterval(() => {
                        const cachedTimestamp: number = MessengerDataExtractor.timestampCache.get(elementId);
                        if (cachedTimestamp !== undefined) {
                            clearInterval(checkInterval);
                            resolve(cachedTimestamp);
                        } else if (!MessengerDataExtractor.pendingRequests.has(elementId)) {
                            clearInterval(checkInterval);
                            resolve(Date.now());
                        }
                    }, 100);

                    setTimeout(() => {
                        clearInterval(checkInterval);
                        reject(new Error('Timestamp extraction timeout for ' + elementId));
                    }, 5000);
                });
            }
        } else {
            elementId = `bdtll_${++MessengerDataExtractor.requestIdCounter}`;
            message.setAttribute('data-bdtll-timestamp-id', elementId);
        }

        const promise: Promise<number> = new Promise<number>((resolve, reject) => {
            MessengerDataExtractor.pendingRequests.set(elementId, { resolve, reject });

            setTimeout(() => {
                if (MessengerDataExtractor.pendingRequests.has(elementId)) {
                    MessengerDataExtractor.pendingRequests.delete(elementId);
                    reject(new Error('Timestamp extraction timeout for ' + elementId));
                }
            }, 5000);
        });

        window.postMessage({
            type: "BDTLL_TIMESTAMP_REQUEST",
            elementId: elementId
        }, '*');

        return promise;
    }

    extractTextContent(message: HTMLElement, config: IMessageExtractionConfig): string {
        return FacebookDataExtractor.extractText(message, config);
    }

    getTooltipHook(message: HTMLElement, config: IMessageExtractionConfig): HTMLElement | null {
        return FacebookDataExtractor.extractHook(message, config);
    }
}
