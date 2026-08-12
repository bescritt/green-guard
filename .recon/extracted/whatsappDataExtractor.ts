import * as BDTLL from "../../../BDTLLCommon";
import { DataExtractor } from "../BDTLL_ChatProtection";
import { LocaleTimestampParser } from "./localeTimestampParser";

const MessageContentSelectors: string[] = [
    "div > div > div > div > div > div > span.copyable-text:not(.quoted-mention)"
];
const MessageTooltipHookSelectors: string[] = [
    "div.message-in.focusable-list-item > div > div:nth-last-child(2) div.copyable-text",
    "div.copyable-text"
];
const ConversationNameSelectors: string[] = [
    "div#main > header span[data-testid='conversation-info-header-chat-title']"
];
const UserResponseSelectors: string[] = [
    "div.message-out"
];
const RootMessageSelectors: string[] = [
    "div#main div[class*='message-'].focusable-list-item"
];
const GroupChatIndicatorSelectors: string[] = [
    "div#main header div:nth-child(2) div:nth-child(2) > span"
];
const UnknownGroupChatSenderSelectors: string[] = [
    "span[aria-label] + span[role='button']"
];
const GeneralGroupChatSenderSelectors: string[] = [
    "div[role]"
];

export class WhatsAppDataExtractor extends DataExtractor {
    constructor(chatProtectionSettings: BDTLL.IChatProtectionSettings, target: HTMLElement = document.body) {
        super(BDTLL.ChatPlatform.WHATSAPP, chatProtectionSettings, target);
    }

    async extractConversationData(): Promise<void> {
        this.conversationName = (this.targetElement.querySelector(ConversationNameSelectors.join()) as HTMLElement)?.innerText;
        this.knownContact = !BDTLL.Utils.isPhoneNumber(this.conversationName);

        this.isGroupChat = ((): boolean => {
            const groupMembers: string[] = this.targetElement.querySelector(GroupChatIndicatorSelectors.join())?.textContent.split(", ");

            if (groupMembers == null || groupMembers.length === 1) {
                return false;
            }

            let knownMembers: number = 0;
            groupMembers.forEach((member: string) => {
                if (!BDTLL.Utils.isPhoneNumber(member)) {
                    knownMembers++;
                }
            });
            this.knownContact = knownMembers > 2; // 1 is 'You', need another known member to confirm

            return true;
        })();

        await super.extractMessages({
            RootMessageSelectors: RootMessageSelectors.join(),
            MessageContentSelectors: MessageContentSelectors.join(),
            MessageTooltipHookSelectors: MessageTooltipHookSelectors.join(),
            GeneralGroupChatSenderSelectors: GeneralGroupChatSenderSelectors.join(),
            UnknownGroupChatSenderSelectors: UnknownGroupChatSenderSelectors.join(),
            UserResponseSelectors: UserResponseSelectors.join(),
            isUserResponse: this.isUserResponse.bind(this),
            extractTimestamp: this.extractTimestamp.bind(this),
            ExcludeContentElementSelectors: "div[role='button']"
        });
    }

    extractTimestamp(message: HTMLElement): number {
        const data: string = message.querySelector("div[data-pre-plain-text]")?.getAttribute("data-pre-plain-text"); // looks like: "[7:17 PM, 7/31/2025] +40 787 617 319: "
        const timestamp: string = data?.split("]")[0].slice(1);

        if (!timestamp || timestamp === "") {
            return Date.now();
        }

        return LocaleTimestampParser.parse(timestamp);
    }

    isUserResponse(message: HTMLElement): boolean {
        return message.matches(UserResponseSelectors.join())
            || message.querySelector(UserResponseSelectors.join()) !== null;
    }
}