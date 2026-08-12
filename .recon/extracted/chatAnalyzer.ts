import * as React from "react";
import * as ReactDOM from "react-dom";
import * as BDTLL from "../../BDTLL";
import { StatusTooltip } from "../../pages/components/statusTooltip";
import { AnalyzerPageStatus } from "../../pages/analyzerPopup/analyzerPageStatus";
import { ConversationProcessor, ConversationProcessorFactory } from "./BDTLL_ChatProtection";

interface INodeAttributes extends React.Attributes {
    id?: string,
    url?: string,
    threatStatus?: BDTLL.PageStatus,
    linkScannerActive?: boolean,
}

export interface IChatResult {
    element?: HTMLElement,
    url?: string,
    request?: string,
    response?: BDTLL.PageStatus,
    conversation?: string
}

export interface IScannedMessage {
    sender: string,
    text: string,
    status?: BDTLL.PageStatus,
    url?: string
}

export interface IStoredConversationStatus {
    platform?: BDTLL.ChatPlatform,
    conversationName?: string,
    messages?: IScannedMessage[],
    userResponded?: boolean,
    contactSaved?: boolean,
    isGroupChat?: boolean
}

export interface IChatAnalyzer {
    renderStatuses(targets: IChatResult[]): void;
    chatProtectionSettings: BDTLL.IChatProtectionSettings;
}

class ChatAnalyzer implements IChatAnalyzer {
    userWhitelist: Array<string>;
    sessionWhitelist: Array<string>;
    conversationProcessor: ConversationProcessor;
    chatProtectionSettings: BDTLL.IChatProtectionSettings

    constructor() {
        if ((window as any).__BDTLL_CHAT_ANALYZER_INITIALIZED__ || document.readyState !== "complete") {
            return;
        }

        (window as any).__BDTLL_CHAT_ANALYZER_INITIALIZED__ = true;

        this.observerConstructor();
    }

    async observerConstructor(): Promise<void> {
        await this.getChatProtectionSettings();

        if (!this.isChatProtectionEnabled()) {
            return;
        }

        await this.getSettings();
        this.conversationProcessor = ConversationProcessorFactory.getPlatformSpecificConversationProcessor(this.userWhitelist, this.sessionWhitelist, this);
        await this.conversationProcessor.observerSetup(document.body);
    }

    isChatProtectionEnabled(): boolean {
        let platformState: boolean = false;
        const currentDomain: BDTLL.ChatPlatform = BDTLL.Utils.currentChatPlatform(
            document.location.href
        );

        switch (currentDomain) {
            case BDTLL.ChatPlatform.WHATSAPP:
                platformState = this.chatProtectionSettings.WhatsappState;
                break;
            case BDTLL.ChatPlatform.FB_MESSENGER:
                platformState = this.chatProtectionSettings.FacebookState;
                break;
            case BDTLL.ChatPlatform.FACEBOOK:
                platformState = this.chatProtectionSettings.FacebookState;
                break;
            case BDTLL.ChatPlatform.TELEGRAM:
                platformState = this.chatProtectionSettings.TelegramState;
                break;
            case BDTLL.ChatPlatform.DISCORD:
                platformState = this.chatProtectionSettings.DiscordState;
                break;
            case BDTLL.ChatPlatform.LINKEDIN:
                platformState = this.chatProtectionSettings.LinkedInState;
                break;
        }

        return this.chatProtectionSettings.ChatProtectionState && platformState;
    }

    async getChatProtectionSettings(): Promise<void> {
        try {
            this.chatProtectionSettings = await BDTLL.MessageService.messageBackground({
                command: BDTLL.Command.GET_CHAT_PROTECTION_SETTINGS
            }) as BDTLL.IChatProtectionSettings;

            this.chatProtectionSettings.ScanPastMessagesTimestamp *= 1000; // convert to milliseconds
        } catch (error) {
            if (BDTLL.DEBUG_MODE) {
                console.error("Error communicating with native host for chat protection settings: ", error);
            }

            this.chatProtectionSettings = {
                ChatProtectionState: false,
                MessagesState: false,
                WhatsappState: false,
                TelegramState: false,
                FacebookState: false,
                DiscordState: false,
                LinkedInState: false,
                ScanContacts: false,
                ScanPastMessages: false,
                ScanPastMessagesTimestamp: 0
            };
        }
    }

    async getSettings(): Promise<void> {
        this.userWhitelist = await whitelist;
        this.sessionWhitelist = await sessionWhitelist;
    }

    renderStatuses(targets: IChatResult[]): void {
        for (const [idx, link] of targets.entries()) {
            let index: number = idx;
            if (document.getElementById(`BDTLL_${link.conversation}_${idx}`) !== null) {
                index += targets.length;
            }

            try {
                const anchor: HTMLElement = this.conversationProcessor.processAnchor(link.element);
                const prevSibling: Element = anchor.previousElementSibling;
                const nextSibling: Element = anchor.nextElementSibling;

                if (prevSibling?.id?.startsWith("BDTLL_") || prevSibling?.classList?.contains("BDTLL_") ||
                    nextSibling?.id?.startsWith("BDTLL_") || nextSibling?.classList?.contains("BDTLL_")) {
                    continue;
                }

                this.renderStatus(index, link, anchor);
            } catch (err) {
                console.log(err);
            }
        }
    }

    renderStatus(id: number, link: IChatResult, anchor: HTMLElement): void {
        const tooltip: HTMLDivElement = this.renderStatusTooltip(id, link);
        const statusTooltipNode: HTMLDivElement = anchor.parentNode.insertBefore(
            tooltip,
            anchor
        );

        this.conversationProcessor.activeTooltips.add(statusTooltipNode);

        this.renderNode(
            StatusTooltip,
            {
                url: BDTLL.Consts.SEARCH_INFO_URL + link.url,
                threatStatus: link.response
            },
            tooltip,
        );

        this.renderStatusPopup(id, link);

        tooltip.firstElementChild.addEventListener('mouseout', () => {
            const popup: HTMLElement = document.getElementById(`TLL_${link.conversation}_${id}`);
            if (popup !== undefined) {
                popup.style.display = "none";
                popup.parentElement.style.display = "none";
            }
        });

        tooltip.firstElementChild.addEventListener('mouseover', () => {
            const rect: DOMRect = statusTooltipNode.getBoundingClientRect();
            const popup: HTMLElement = document.getElementById(`TLL_${link.conversation}_${id}`);
            if (popup !== undefined) {
                popup.style.display = "block";
                popup.style.left = (rect.left + window.scrollX).toFixed(0) + "px";
                popup.style.top = (rect.top + window.scrollY + 22).toFixed(0) + "px";
                popup.parentElement.style.display = "block";
            }
        });
    }

    renderStatusPopup(id: number, target: IChatResult): void {
        const container: HTMLDivElement = document.createElement('div');
        container.style.display = "none";

        const previousPopup: HTMLElement = document.getElementById(`TLL_${target.conversation}_${id}`);
        if (previousPopup != null) {
            previousPopup.parentElement.remove();
        }

        document.body.appendChild(container);

        this.renderNode(
            AnalyzerPageStatus,
            {
                id: `TLL_${target.conversation}_${id}`,
                url: target.url,
                threatStatus: target.response,
                linkScannerActive: true,
            },
            container,
        )
    }

    renderStatusTooltip(id: number, target: IChatResult): HTMLDivElement {
        const container: HTMLDivElement = document.createElement('div');

        container.setAttribute("id", `BDTLL_${target.conversation}_${id}`);
        container.setAttribute("conversation", target.conversation);

        this.conversationProcessor.activeTooltips.add(container);

        container.addEventListener('click', (event) => {
            // When clicking on the status bullet open new tab with bitdefender page.
            let encodedURL = target.url;
            try {
                encodedURL = encodeURIComponent(target.url);
            } catch (err) {
                console.log(err);
            }

            window.open(
                `${BDTLL.Consts.SEARCH_INFO_URL}${encodedURL}`,
                "_blank"
            );

            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();

            return false;
        });

        return container;
    }

    renderNode(component: string | React.FunctionComponent | React.ComponentClass, attributes: INodeAttributes, container: HTMLDivElement): void {
        ReactDOM.render(
            React.createElement(component, attributes, null),
            container
        );
    }
}

const whitelist: Promise<string[]> = BDTLL.MessageService.messageBackground({
    command: BDTLL.Command.GET_WHITELIST
}) as Promise<string[]>;

const sessionWhitelist: Promise<string[]> = BDTLL.MessageService.messageBackground({
    command: BDTLL.Command.GET_SESSION_WHITELIST,
}) as Promise<string[]>;

const CA: ChatAnalyzer = new ChatAnalyzer();
