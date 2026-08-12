import * as BDTLL from "../../../BDTLLCommon";
import { DataExtractor, IMessageExtractionConfig } from "../BDTLL_ChatProtection";
import { LocaleTimestampParser } from "./localeTimestampParser";

const MessageContentSelectors: string[] = [
    "div[role='none'] span[dir='auto']:has(div:first-child)",
    ":scope > div:nth-child(3) > div:nth-child(2) div[role='presentation'] > span"
];
const MessageTooltipHookSelectors: string[] = [
    ":scope > div:nth-child(3) > div:nth-child(2) div[role='presentation'] > span > div:last-child",
    ":scope div[role='none'] span[dir='auto'] > div:last-child",
    ":scope > div:not([role='presentation']) div[role='presentation']:not([tabindex]) > span[dir] > div[dir]"
];
const ConversationNameSelectors: string[] = [
    "span.html-span h2[dir='auto']"
];
const UserResponseSelectors: string[] = [
    "div[data-scope='messages_table'] div.html-div:nth-child(5)"
];
const RootMessageSelectors: string[] = [
    "div[data-scope='messages_table']"
];
const UnknownContactSelectors: string[] = [
    "div[role='none'][tabIndex='-1'] div[role='alert']"
];
const GroupChatIndicatorSelectors: string[] = [
    "div[data-visualcompletion='ignore-dynamic'] > div:first-child > div:nth-child(2)"
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

export class FacebookDataExtractor extends DataExtractor {
    private lastTimestamp: number | null = null;

    constructor(chatProtectionSettings: BDTLL.IChatProtectionSettings, target: HTMLElement = document.body) {
        super(BDTLL.ChatPlatform.FACEBOOK, chatProtectionSettings, target);
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
            extractTimestamp: this.extractTimestamp.bind(this)
        });
    }

    static isUserResponse(message: HTMLElement): boolean {
        for (const row of Array.from(message.children)) {
            const computedStyles: CSSStyleDeclaration = window.getComputedStyle(row);
            const flexDirection: string = computedStyles.getPropertyValue('flex-direction');

            if (flexDirection === 'row-reverse') {
                return true;
            }
        }

        return false;
    }

    extractTimestamp(message: HTMLElement): number {
        const timestampText: string = message.querySelector(TimestampSelectors.join())?.textContent?.trim() ?? "";
        if (!timestampText) {
            if (this.lastTimestamp === null) {
                return Date.now();
            }
            return this.lastTimestamp;
        }

        const parsedTimestamp: number = LocaleTimestampParser.parse(timestampText);
        this.lastTimestamp = parsedTimestamp;

        return parsedTimestamp;
    }

    static extractText(message: HTMLElement, config: IMessageExtractionConfig): string {
        const content: NodeListOf<HTMLElement> = message.querySelectorAll(config.MessageContentSelectors);
        if (content.length === 0) {
            return null;
        }

        return content.item(content.length - 1).innerText;
    }

    static extractHook(message: HTMLElement, config: IMessageExtractionConfig): HTMLElement | null {
        const hooks: NodeListOf<HTMLElement> = message.querySelectorAll(config.MessageTooltipHookSelectors);
        if (hooks.length === 0) {
            return null;
        }

        return hooks.item(hooks.length - 1);
    }

    extractTextContent(message: HTMLElement, config: IMessageExtractionConfig): string {
        return FacebookDataExtractor.extractText(message, config);
    }

    getTooltipHook(message: HTMLElement, config: IMessageExtractionConfig): HTMLElement | null {
        return FacebookDataExtractor.extractHook(message, config);
    }
}
