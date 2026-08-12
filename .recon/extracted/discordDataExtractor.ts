import * as BDTLL from "../../../BDTLLCommon";
import { DataExtractor } from "../BDTLL_ChatProtection";

const MessageContentSelectors: string[] = [
    "div[class*='message'] div[class*='contents'] div[class*='messageContent']"
];
const MessageTooltipHookSelectors: string[] = [
    "div[class*='message'] div[class*='contents'] div[class*='messageContent']"
];
const ConversationNameSelectors: string[] = [
    "div[class*='chat'] div[class*='titleWrapper']",          // direct message and server
    "div[class*='chat'] section span + div > div:nth-child(2)",
    "div[class*='chat'] section[class*='title'] div[class*='hoverableContainer']"   // group chat
];
const UserResponseSelectors: string[] = [
    "div[class*='contents'] span[class*='headerText']"
];
const RootMessageSelectors: string[] = [
    "main[class*='chatContent'] li[class*='messageListItem']"
];
const UnknownContactSelectors: string[] = [
    "main[class*='chatContent'] div[class*='inline'] > div[class*='inline']:last-child",    // direct message
    "main[class*='chatContent'] div[class*='stack_']",
    "div[class*='isSystemMessage'] div[class*='content'] a:last-of-type > span"               // group chat and server
];
const GroupChatIndicatorSelectors: string[] = [
    "div[class*='subtitleContainer'] foreignObject"
];
const GroupChatSenderSelectors: string[] = [
    "div[class*='contents'] span[class*='headerText']"
];
const GlobalUsernameSelectors: string[] = [
    "div[class*='panelTitleContainer'] div[class*='title']"
];
const UserProfilePictureSelectors: string[] = [
    "div[class*='avatarWrapper'] img",
    "div[class*='account'] div[class*='wrapper'][class*='avatar'] img"
];
const TimestampSelectors: string[] = [
    "h3[class*='header'] time"
];
const ServerSelector: string[] = [
    "#channels"
];
export class DiscordDataExtractor extends DataExtractor {
    constructor(chatProtectionSettings: BDTLL.IChatProtectionSettings, target: HTMLElement = document.body) {
        super(BDTLL.ChatPlatform.DISCORD, chatProtectionSettings, target);
    }

    async extractConversationData(): Promise<void> {
        const conversationElement = this.targetElement.querySelector(ConversationNameSelectors.join()) as HTMLElement;
        this.conversationName = conversationElement?.innerText?.replace(/\n/g, ' ')?.trim() ?? "";
        const userProfilePictureElement: HTMLElement = this.targetElement.querySelector(UserProfilePictureSelectors.join());
        const usernameElement: HTMLElement = this.targetElement.querySelector(GlobalUsernameSelectors.join());

        if (userProfilePictureElement === null || usernameElement === null) {
            return;
        }

        const userProfilePicture: string = userProfilePictureElement.getAttribute("src")?.split("?")?.[0];

        if (!userProfilePicture) {
            return;
        }

        const username: string = usernameElement.textContent.trim();
        const messageHeaders: NodeListOf<HTMLElement> = this.targetElement.querySelectorAll(UserResponseSelectors.join());

        for (let i = 0; i < messageHeaders.length; i++) {
            const src = messageHeaders[i].parentElement.previousElementSibling?.getAttribute("src");
            const messageUserProfilePicture = src ? src.split("?")[0] : undefined;
            if (messageUserProfilePicture === userProfilePicture) {
                messageHeaders[i].classList.add("tll-username");
            }
        }

        const indicator: HTMLElement | null = this.targetElement.querySelector(GroupChatIndicatorSelectors.join());
        this.isGroupChat = (indicator?.children?.length ?? 0) > 1 || document.querySelector(ServerSelector.join()) !== null;

        if (this.isGroupChat) {
            let flag: boolean = true;
            const newlyJoinedMembers: NodeListOf<HTMLElement> = this.targetElement.querySelectorAll(UnknownContactSelectors.join());

            for (let i = 0; i < newlyJoinedMembers.length; i++) {
                if (newlyJoinedMembers[i].textContent === username) {
                    flag = false;
                    break;
                }
            }

            this.knownContact = flag;
        } else {
            const newConversationButtons: HTMLElement = this.targetElement.querySelector(UnknownContactSelectors.join());
            this.knownContact = newConversationButtons?.children.length < 3;
        }

        await super.extractMessages({
            RootMessageSelectors: RootMessageSelectors.join(),
            MessageContentSelectors: MessageContentSelectors.join(),
            MessageTooltipHookSelectors: MessageTooltipHookSelectors.join(),
            GeneralGroupChatSenderSelectors: GroupChatSenderSelectors.join(),
            UserResponseSelectors: ".tll-username",
            conversationLayoutIsList: true,
            ExcludeContentElementSelectors: "span[class*='timestamp']",
            extractTimestamp: this.extractTimestamp.bind(this)
        });
    }

    extractTimestamp(message: HTMLElement): number {
        const timestamp: string = message.querySelector(TimestampSelectors.join())?.getAttribute("datetime"); // looks like: "2025-02-17T15:06:00.749Z"

        if (!timestamp || timestamp === "") {
            return Date.now();
        }

        return Date.parse(timestamp);
    }
}