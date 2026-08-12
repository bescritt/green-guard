import * as BDTLL from "../../../BDTLLCommon";
import { DataExtractor } from "./dataExtractor";
import { LocaleTimestampParser } from "./localeTimestampParser";

const MessageContentSelectors: string[] = [
    "div.msg-s-event__content"
];
const MessageTooltipHookSelectors: string[] = [
    "div.msg-s-event-listitem div.msg-s-event-listitem__message-bubble"
];
const ConversationNameSelectors: string[] = [
    "h2.msg-entity-lockup__entity-title",   // full page conversation
    "h2.msg-overlay-bubble-header__title"   // overlay conversation
];
const UserResponseSelectors: string[] = [
    "li.msg-s-message-list__event img.msg-s-event-listitem__profile-picture",   // direct message
    "li.msg-s-message-list__event img.presence-entity__image"                   // group chat
];
export const RootMessageSelectors: string[] = [
    "li.msg-s-message-list__event"
];
const UnknownContactSelectors: string[] = [
    "div.msg-s-event-listitem--inmail",             // linkedin premium
    "div[class^=\"msg-pending-message-request\"]"   // message request
];
const GroupChatIndicatorSelectors: string[] = [
    "a.msg-thread__link-to-profile",
    "a.profile-card-one-to-one__profile-link"
];
const GroupChatSenderSelectors: string[] = [
    "span.msg-s-message-group__name"
];
const GlobalUsernameSelectors: string[] = [
    "div.msg-overlay-bubble-header__details img.presence-entity__image"
];
export const IgnoreOverlaySelectors: string[] = [
    "div.scaffold-layout__detail "
];
export const ConversationOverlaySelectors: string[] = [
    "div.msg-overlay-conversation-bubble--jumbo"
];
export const IFrameSelector: string = "iframe[src='/preload/']";
export const ShadowDomSelector: string = "#interop-outlet";
export const OverlaysRootSelector: string = "#msg-overlay"

export class LinkedInDataExtractor extends DataExtractor {
    date: string = "";
    time: string = "";

    constructor(chatProtectionSettings: BDTLL.IChatProtectionSettings, target: HTMLElement = document.body) {
        super(BDTLL.ChatPlatform.LINKEDIN, chatProtectionSettings, target?.shadowRoot || target);
        this.isOverlay =
            this.targetElement instanceof ShadowRoot ||
            (this.targetElement as HTMLElement).closest(OverlaysRootSelector) !== null;
    }

    async extractConversationData(): Promise<void> {
        this.conversationName = (this.targetElement.querySelector(ConversationNameSelectors.join()) as HTMLElement)?.innerText.trim();

        let overlaysHost: HTMLElement | ShadowRoot = document.documentElement;

        const shadowDom: ShadowRoot = document.querySelector(ShadowDomSelector)?.shadowRoot;
        const iframe: HTMLIFrameElement = document.querySelector(IFrameSelector);

        if (iframe?.contentDocument.querySelector(GlobalUsernameSelectors.join())) {
            overlaysHost = iframe.contentDocument.documentElement || document.documentElement;
        } else if (shadowDom?.querySelector(GlobalUsernameSelectors.join())) {
            overlaysHost = shadowDom || document.documentElement;
        }

        const usernameElement: HTMLElement = overlaysHost.querySelector(GlobalUsernameSelectors.join());

        if (usernameElement == null) {
            return;
        }

        const username: string = usernameElement.getAttribute("alt");
        const userProfilePicture: string = usernameElement.getAttribute("src");

        let selectorUserRespondedElement: string = UserResponseSelectors.join();
        let selectorUnknownContactElement: string = UnknownContactSelectors.join();
        let selectorGroupChatElement: string = GroupChatIndicatorSelectors.join();
        let selectorRootMessageElement: string = RootMessageSelectors.join();

        if (!this.isOverlay) {
            selectorUnknownContactElement = IgnoreOverlaySelectors.join() + selectorUnknownContactElement;
            selectorUserRespondedElement = IgnoreOverlaySelectors.join() + selectorUserRespondedElement;
            selectorGroupChatElement = IgnoreOverlaySelectors.join() + selectorGroupChatElement;
            selectorRootMessageElement = IgnoreOverlaySelectors.join() + selectorRootMessageElement;
        }

        const messageHeaders: NodeListOf<HTMLElement> = this.targetElement.querySelectorAll(UserResponseSelectors.join());

        for (let i = 0; i < messageHeaders.length; i++) {
            if (messageHeaders[i].getAttribute("alt") === username &&
                messageHeaders[i].getAttribute("src") === userProfilePicture) {
                messageHeaders[i].classList.add("tll-username");
            }
        }

        this.knownContact = this.targetElement.querySelector(selectorUnknownContactElement) === null;
        this.isGroupChat = this.targetElement.querySelector(selectorGroupChatElement) === null;

        await super.extractMessages({
            RootMessageSelectors: selectorRootMessageElement,
            MessageContentSelectors: MessageContentSelectors.join(),
            MessageTooltipHookSelectors: MessageTooltipHookSelectors.join(),
            GeneralGroupChatSenderSelectors: GroupChatSenderSelectors.join(),
            UserResponseSelectors: ".tll-username",
            conversationLayoutIsList: true,
            extractTimestamp: this.extractTimestamp.bind(this)
        });
    }

    extractTimestamp(message: HTMLElement): number {
        let timeElement: HTMLElement = message.querySelector("time[class*=\"timestamp\"]"); // looks like: "12:24 PM"
        let dateElement: HTMLElement = message.querySelector("time[class*=\"time-heading\"]"); // looks like: "Feb 7, 2025"

        let messageTime: string = this.time;

        if (timeElement !== null && timeElement.innerText !== "") {
            messageTime = timeElement.innerText.trim();
            this.time = messageTime;
        }

        let messageDate: string = this.date;

        if (dateElement !== null && dateElement.innerText !== "") {
            messageDate = dateElement.innerText.trim();
            if (messageDate.length < 10) {
                messageDate = messageDate + " " + new Date().getFullYear();
            }
            this.date = messageDate;
        }

        if (this.date === "" || this.time === "") {
            return Date.now();
        }

        return LocaleTimestampParser.parse(messageDate + " " + messageTime);
    }
}