import * as BDTLL from "../../../BDTLLCommon";
import { DataExtractor } from "../BDTLL_ChatProtection";
import { LocaleTimestampParser } from "./localeTimestampParser";

const MessageContentSelectors: string[] = [
    "div.message-content-wrapper.can-select-text div.content-inner div.text-content",	// version a
    "div.bubble-content div.message"                                      // version k
];
const MessageTooltipHookSelectors: string[] = [
    "div.message-content-wrapper.can-select-text div.content-inner",	// version a
    "div.bubble-content div.message"                                    // version k
];
const ConversationNameSelectors: string[] = [
    "div.MiddleHeader h3.fullName",								// version a
    "div.chat-info-container div.user-title span.peer-title"	// version k
];
const UserResponseSelectors: string[] = [
    "div.with-outgoing-icon",	    // version a
    "div.bubble.is-out"	// version k
];
const RootMessageSelectors: string[] = [
    "div.MessageList div.Message.message-list-item",	// version a
    "div.chat .bubble:not(.is-date)"					// version k
];
const UnknownContactSelectors: string[] = [
    "div.ChatReportPane",					// version a
    "div.topbar.is-pinned-actions-shown"	// version k
];
const GroupChatIndicatorSelectors: string[] = [
    "div.ChatInfo span.group-status",	// version a
    "div.chat-info div.info > span"		// version k
];
const GroupChatSenderSelectors: string[] = [
    "span.sender-title",	// version a
    "span.peer-title"		// version k
];
const TimestampSelectors: string[] = [
    "span.message-time",	// version a
    "div.time-inner"		// version k
];
const VersionWebK: string = "web.telegram.org/k";
const VersionWebA: string = "web.telegram.org/a";

export class TelegramDataExtractor extends DataExtractor {
    private version: string = VersionWebA;

    constructor(chatProtectionSettings: BDTLL.IChatProtectionSettings, target: HTMLElement = document.body) {
        super(BDTLL.ChatPlatform.TELEGRAM, chatProtectionSettings, target);

        if (document.location.href.includes(VersionWebK)) {
            this.version = VersionWebK;
        }

        if (BDTLL.DEBUG_MODE) {
            console.log(`Detected version ${this.version.charAt(this.version.length - 1).toUpperCase()} of telegram`);
        }
    }

    async extractConversationData(): Promise<void> {
        this.conversationName = (this.targetElement.querySelector(ConversationNameSelectors.join()) as HTMLElement)?.innerText;
        this.knownContact = this.targetElement.querySelector(UnknownContactSelectors.join()) === null;
        const groupChatIndicator: HTMLElement = this.targetElement.querySelector(GroupChatIndicatorSelectors.join());

        if (this.version === VersionWebK) {
            if (groupChatIndicator === null) {
                return;
            }

            const groupChatSubtitle: string[] = groupChatIndicator?.textContent.split(" ");
            this.isGroupChat = !Number.isNaN(parseInt(groupChatSubtitle[0]));
        } else {
            this.isGroupChat = groupChatIndicator !== null;
        }

        await super.extractMessages({
            RootMessageSelectors: RootMessageSelectors.join(),
            MessageContentSelectors: MessageContentSelectors.join(),
            MessageTooltipHookSelectors: MessageTooltipHookSelectors.join(),
            GeneralGroupChatSenderSelectors: GroupChatSenderSelectors.join(),
            UserResponseSelectors: UserResponseSelectors.join(),
            extractTimestamp: this.extractTimestamp.bind(this),
            isUserResponse: this.isUserResponse.bind(this)
        });
    }

    isUserResponse(message: HTMLElement): boolean {
        return message.matches(UserResponseSelectors.join())
            || message.querySelector(UserResponseSelectors.join()) !== null;
    }

    extractTimestamp(message: HTMLElement): number {
        const messageTimeElement: HTMLElement = message.querySelector(TimestampSelectors.join());

        if (messageTimeElement === null) {
            return Date.now();
        }

        let locale: string;
        if (this.version !== VersionWebK) {
            // on version A the timestamp attribute appears only after a hover
            messageTimeElement.dispatchEvent(new MouseEvent("mouseenter"));
        } else {
            // locale doesn't change on version K
            locale = "en-GB";
        }

        const timestamp: string = messageTimeElement.getAttribute("title"); // looks like: "Feb 7, 2025, 12:24:21"

        if (!timestamp || timestamp === "") {
            return Date.now();
        }

        return LocaleTimestampParser.parse(timestamp, locale);
    }
}