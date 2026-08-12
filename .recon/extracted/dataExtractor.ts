import * as BDTLL from "../../../BDTLLCommon";

export interface IExtractedMessage {
    sender: string,
    text: string,
    timestamp?: number,
    tooltipHook?: HTMLElement | null
}

export interface IMessageExtractionConfig {
    RootMessageSelectors: string,
    MessageContentSelectors: string,
    MessageTooltipHookSelectors: string,
    GeneralGroupChatSenderSelectors: string,
    UnknownGroupChatSenderSelectors?: string,
    UserResponseSelectors: string,
    ExcludeContentElementSelectors?: string,
    conversationLayoutIsList?: boolean,
    isUserResponse?: (message: HTMLElement) => boolean,
    extractTimestamp: (message: HTMLElement) => number | Promise<number>
}

export abstract class DataExtractor {
    platform: BDTLL.ChatPlatform;
    messages: IExtractedMessage[];
    targetElement: HTMLElement | ShadowRoot;
    isOverlay: boolean = false;

    conversationName: string = "";
    knownContact: boolean = false;
    userResponded: boolean = false;
    isGroupChat: boolean = false;
    scanContacts: boolean = false;
    scanPastMessages: boolean = false;
    scanPastMessagesTimestamp: number = 0;

    constructor(
        platform: BDTLL.ChatPlatform,
        chatProtectionSettings: BDTLL.IChatProtectionSettings,
        target: HTMLElement | ShadowRoot = document.body
    ) {
        this.platform = platform;
        this.messages = [];
        this.targetElement = target;
        this.isOverlay = target !== document.body;
        this.scanContacts = chatProtectionSettings.ScanContacts;
        this.scanPastMessages = chatProtectionSettings.ScanPastMessages;
        this.scanPastMessagesTimestamp = chatProtectionSettings.ScanPastMessagesTimestamp;
    }

    abstract extractConversationData(): Promise<void>;

    async extractMessages(config: IMessageExtractionConfig): Promise<void> {
        const conversationMessages: NodeListOf<HTMLElement> = this.targetElement.querySelectorAll(config.RootMessageSelectors);
        let lastSender: HTMLElement;
        let username: string;

        for (const message of Array.from(conversationMessages)) {
            let timestamp: number;
            try {
                timestamp = await config.extractTimestamp(message);
            } catch (error) {
                if (BDTLL.DEBUG_MODE) {
                    console.error(error);
                }
                timestamp = Date.now();
            }

            if (!timestamp) {
                continue;
            }

            if (!this.scanPastMessages && timestamp < this.scanPastMessagesTimestamp) {
                continue;
            }

            if (config.isUserResponse) {
                // for Facebook/Messenger/Telegram/WhatsApp it's not important to set the last sender since all
                // user-sent messages follow the same selector pattern, so isUserResponse returns true in those cases
                if (config.isUserResponse(message)) {
                    this.userResponded = true;
                    continue;
                }
            } else {
                // for Discord/Linkedin all messages are the same, so if one message is sent by the user we
                // need to assume that all consecutive messages until the next sender are sent by him
                // and ignore them from scan
                const userResponse: HTMLElement = message.querySelector(config.UserResponseSelectors);
                if (userResponse) {
                    this.userResponded = true;
                    lastSender = userResponse;
                    username = lastSender.innerText;
                    continue;
                }
            }

            const extractedSender: HTMLElement = this.extractTextSender(message, config);
            lastSender = extractedSender || lastSender;

            if (config.conversationLayoutIsList) {
                const messageSender: string = lastSender?.innerText;
                if (messageSender === username) {
                    continue;
                }
            }

            const textContent: string = this.extractTextContent(message, config);
            if (textContent === null ||
                (!BDTLL.Utils.validURL(textContent, false) &&
                    !BDTLL.Utils.isIpAddress(textContent, false))) {
                continue;
            }

            let sender: string = this.conversationName;
            if (this.isGroupChat) {
                sender = lastSender ? lastSender.innerText : sender;
            }

            this.messages.push({
                sender: sender,
                text: textContent,
                timestamp: timestamp,
                tooltipHook: this.getTooltipHook(message, config)
            });
        }
    }

    getTooltipHook(message: HTMLElement, config: IMessageExtractionConfig): HTMLElement | null {
        return message.querySelector(config.MessageTooltipHookSelectors);
    }

    extractTextSender(message: HTMLElement, config: IMessageExtractionConfig): HTMLElement {
        if (config.UnknownGroupChatSenderSelectors) {
            return (message.querySelector(config.UnknownGroupChatSenderSelectors) ||
                message.querySelector(config.GeneralGroupChatSenderSelectors));
        }

        return message.querySelector(config.GeneralGroupChatSenderSelectors);
    }

    extractTextContent(message: HTMLElement, config: IMessageExtractionConfig): string {
        const content: HTMLElement = message.querySelector(config.MessageContentSelectors);
        if (content === null) {
            return null;
        }

        let textContent: string = content.innerText;
        if (config.ExcludeContentElementSelectors) {
            const excludeElements: NodeListOf<HTMLElement> = message.querySelectorAll(config.ExcludeContentElementSelectors);
            excludeElements.forEach((excludeElement) => {
                textContent = textContent.replace(excludeElement.innerText, "");
            });
        }

        return textContent;
    }

    hasSameMessageList(chatData: DataExtractor): boolean {
        if (this.messages.length !== chatData.messages.length) {
            return false;
        }

        for (let i = 0; i < this.messages.length; i++) {
            if (this.messages[i].text !== chatData.messages[i].text ||
                this.messages[i].sender !== chatData.messages[i].sender ||
                this.messages[i].tooltipHook !== chatData.messages[i].tooltipHook) {
                return false;
            }
        }

        return true;
    }

    isSameConversation(chatData: DataExtractor): boolean {
        return (
            this.conversationName === chatData.conversationName &&
            this.isOverlay === chatData.isOverlay &&
            this.targetElement === chatData.targetElement &&
            this.knownContact === chatData.knownContact &&
            this.userResponded === chatData.userResponded &&
            this.isGroupChat === chatData.isGroupChat &&
            this.hasSameMessageList(chatData)
        );
    }

    isEmpty(): boolean {
        return (
            this.conversationName === undefined &&
            this.messages.length === 0
        );
    }

    isSuspicious(): boolean {
        return (
            (!this.knownContact || this.scanContacts) && !this.isEmpty()
        );
    }

    /**
     * @description performs a shallow copy of chatData
     */
    copy(chatData: DataExtractor): void {
        this.conversationName = chatData.conversationName;
        this.platform = chatData.platform;
        this.knownContact = chatData.knownContact;
        this.userResponded = chatData.userResponded;
        this.isGroupChat = chatData.isGroupChat;
        this.messages = [...chatData.messages];
        this.isOverlay = chatData.isOverlay;
        this.targetElement = chatData.targetElement;
    }
}