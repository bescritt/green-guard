import * as BDTLL from "../../../BDTLL";
import { IChatAnalyzer, DataExtractor, DataExtractorFactory } from "../BDTLL_ChatProtection"

const tooltipAddedSelector: string = "div[id^='BDTLL_']";
export abstract class ConversationProcessor {
    userWhitelist: string[];
    sessionWhitelist: string[];
    activeTooltips: Set<HTMLElement>;
    elementObservers: Map<HTMLElement, MutationObserver>;
    manualClear: boolean;
    chatAnalyzer: IChatAnalyzer;
    messagesPendingScan: Set<string>;
    scanResultCache: Map<string, BDTLL.IScannedMessage>;

    constructor(userWhitelist: string[] = [], sessionWhitelist: string[] = [], chatAnalyzer: IChatAnalyzer) {
        this.userWhitelist = userWhitelist;
        this.sessionWhitelist = sessionWhitelist;
        this.activeTooltips = new Set<HTMLElement>();
        this.elementObservers = new Map<HTMLElement, MutationObserver>();
        this.messagesPendingScan = new Set<string>();
        this.scanResultCache = new Map<string, BDTLL.IScannedMessage>();
        this.manualClear = false;
        this.chatAnalyzer = chatAnalyzer;
    }

    abstract observerSetup(element: HTMLElement): Promise<void>;
    abstract processAnchor(hook: HTMLElement): HTMLElement;

    debounce(func: Function, timeout = 300) {
        let timer: NodeJS.Timeout;
        return (...args: any) => {
            clearTimeout(timer);
            timer = setTimeout(() => { func.apply(this, args); }, timeout);
        };
    }

    async singleObserverSetup(targetElement: HTMLElement): Promise<void> {
        const chatData: DataExtractor = DataExtractorFactory.getPlatformSpecificDataExtractor(
            targetElement, this.chatAnalyzer.chatProtectionSettings
        );
        await chatData.extractConversationData();

        if (chatData.isSuspicious()) {
            await this.scanConversation(chatData);
        }

         const processConversation: Function = this.debounce(async () => {
            let isHostReRender: boolean = false;
            const newChatData: DataExtractor = DataExtractorFactory.getPlatformSpecificDataExtractor(
                targetElement, this.chatAnalyzer.chatProtectionSettings
            );
            await newChatData.extractConversationData();

            if (newChatData.isSuspicious() && targetElement.querySelector(tooltipAddedSelector) == null) {
                isHostReRender = true;
            }

            if (newChatData.isEmpty() || (!isHostReRender && newChatData.isSameConversation(chatData))) {
                return;
            }

            // the first scan request in a new conversation is made with the previous message list in some edge cases
            if (newChatData.conversationName !== chatData.conversationName) {
                if (chatData.hasSameMessageList(newChatData)) {
                    return;
                }
            }

            this.clearTooltips(newChatData.conversationName, newChatData.isOverlay);
            chatData.copy(newChatData);

            if (chatData.isSuspicious()) {
                await this.scanConversation(chatData);
            }
        }, 100)

        const conversationObserver: MutationObserver = new MutationObserver(async (mutations: MutationRecord[]) => {
            let sawTooltipNode: boolean = false;
            let sawNonTooltipNode: boolean = false;

            for (const mutation of mutations) {
                if (mutation.type !== "childList") {
                    continue;
                }

                for (let i = 0; i < mutation.addedNodes.length; i++) {
                    const node: HTMLElement = mutation.addedNodes[i] as HTMLElement;

                    if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.COMMENT_NODE) {
                        continue;
                    }

                    if (node.querySelector(tooltipAddedSelector) !== null) {
                        sawTooltipNode = true;
                        continue;
                    }

                    sawNonTooltipNode = true;
                }
            }

            if (sawTooltipNode && !sawNonTooltipNode) {
                return;
            }

            await processConversation();
        });

        conversationObserver.observe(targetElement, {
            subtree: true,
            childList: true,
            characterData: true
        });

        this.elementObservers.set(targetElement, conversationObserver);
    }

    clearTooltips(conversation: string, overlay: boolean): void {
        this.manualClear = true;
        const attributeName: string = overlay ? conversation + "_overlay" : conversation;

        this.activeTooltips.forEach((element: HTMLDivElement) => {
            if (element.getAttribute("conversation") === attributeName) {
                element.remove();
                this.activeTooltips.delete(element);
            }
        });
        this.manualClear = false;
    }

    async scanConversation(chatData: DataExtractor): Promise<BDTLL.IChatResult[]> {
        if (chatData.messages.length === 0) {
            return;
        }

        const messageHashes = await Promise.all(
            chatData.messages.map(async (message): Promise<{ message: BDTLL.IExtractedMessage; hash: string }> => ({
                message,
                hash: await this.hashText(message.text)
            }))
        );

        const processedHashes: Set<string> = new Set();
        const messagesToProcess: BDTLL.IExtractedMessage[] = [];
        for (const { message, hash } of messageHashes) {
            if (processedHashes.has(hash) || this.scanResultCache.has(hash) || this.messagesPendingScan.has(hash)) {
                continue;
            }
            this.messagesPendingScan.add(hash);
            processedHashes.add(hash);
            messagesToProcess.push(message);
        }
        const messagesToProcessHashes: Set<string> = new Set(processedHashes);

        if (messagesToProcess.length === 0) {
            const cachedLinks: BDTLL.IChatResult[] = [];
            for (const { message, hash } of messageHashes) {
                const cachedMessage: BDTLL.IScannedMessage = this.scanResultCache.get(hash);
                const hook: HTMLElement = message.tooltipHook;
                if (!cachedMessage || !cachedMessage.url || cachedMessage.status === undefined || !hook) {
                    continue;
                }

                const domain: string = BDTLL.Utils.extractRootDomain(cachedMessage.url);
                let status: BDTLL.PageStatus = cachedMessage.status;

                if (this.userWhitelist.indexOf(domain) > -1) {
                    status = BDTLL.PageStatus.WHITELISTED;
                } else if (this.sessionWhitelist.indexOf(domain) > -1) {
                    status = BDTLL.PageStatus.SESSION_WHITELISTED;
                }

                cachedLinks.push({
                    element: hook,
                    response: status,
                    url: cachedMessage.url,
                    conversation: chatData.isOverlay ? chatData.conversationName + "_overlay" : chatData.conversationName
                });
            }

            if (cachedLinks.length > 0) {
                this.chatAnalyzer.renderStatuses(cachedLinks);
                return;
            }

            if (BDTLL.DEBUG_MODE) {
                console.log("Skipping duplicate scan - all messages already pending");
            }
            return;
        }

        const hashConversationName: string = await this.hashText(chatData.conversationName);
        const storageResult: BDTLL.IStoredConversationStatus = await BDTLL.MessageService.messageBackground({
            command: BDTLL.Command.GET_MESSAGES,
            smsConversation: {
                platform: chatData.platform,
                conversationName: hashConversationName
            }
        }) as BDTLL.IStoredConversationStatus;

        if (!chatData.messages[0].tooltipHook.isConnected) {
            // conversation has changed since the last scan call while waiting for stored messages
            return;
        }

        let links: BDTLL.IChatResult[] = [];
        let conversationMap: Map<string, BDTLL.IScannedMessage> = new Map<string, BDTLL.IScannedMessage>();
        let statusArray: BDTLL.IScannedMessage[] = storageResult?.messages;

        statusArray?.forEach((message: BDTLL.IScannedMessage) => {
            conversationMap.set(message.text, message);
        });

        if (storageResult == null) {
            statusArray = await this.requestScanMessages(chatData, messagesToProcess);
        } else {
            const newMessages: BDTLL.IExtractedMessage[] = (
                await Promise.all(
                    messagesToProcess.map(async (message: BDTLL.IExtractedMessage) => {
                        const hashedTest: string = await this.hashText(message.text);

                        if (conversationMap.has(hashedTest)) {
                            this.messagesPendingScan.delete(hashedTest);
                            return null;
                        }

                        return message
                    })
                )
            ).filter(item => item !== null);

            if (newMessages.length > 0) {
                statusArray.push(... await this.requestScanMessages(chatData, newMessages));
            }
        }

        if (statusArray.length === 0) {
            // scan request already made, waiting for response
            return;
        }

        statusArray.forEach((message: BDTLL.IScannedMessage) => {
            conversationMap.set(message.text, message);
            this.scanResultCache.set(message.text, message);
        });

        for (const { hash } of messageHashes) {
            const cachedMessage: BDTLL.IScannedMessage = this.scanResultCache.get(hash);
            if (!cachedMessage) {
                continue;
            }
            this.messagesPendingScan.delete(hash);
            conversationMap.set(hash, cachedMessage);
        }

        for (const { hash } of messageHashes) {
            if (!messagesToProcessHashes.has(hash)) {
                continue;
            }
            if (!conversationMap.has(hash)) {
                this.messagesPendingScan.delete(hash);
            }
        }

        for (const { message, hash } of messageHashes) {
            const match: BDTLL.IScannedMessage = conversationMap.get(hash);
            if (!match) {
                continue;
            }

            if (match.url === "invalid-url") {
                continue;
            }

            const domain: string = BDTLL.Utils.extractRootDomain(match.url);
            let status: BDTLL.PageStatus = match.status;

            if (this.userWhitelist.indexOf(domain) > -1) {
                status = BDTLL.PageStatus.WHITELISTED;
            } else if (this.sessionWhitelist.indexOf(domain) > -1) {
                status = BDTLL.PageStatus.SESSION_WHITELISTED;
            }

            const scannedMessage: BDTLL.IChatResult = {
                element: message.tooltipHook,
                response: status,
                url: match.url,
                conversation: chatData.isOverlay ? chatData.conversationName + "_overlay" : chatData.conversationName
            };

            links.push(scannedMessage);
        }

        this.chatAnalyzer.renderStatuses(links);

        await BDTLL.MessageService.messageBackground({
            command: BDTLL.Command.SET_MESSAGES,
            smsConversation: {
                conversationName: hashConversationName,
                platform: chatData.platform,
                messages: statusArray
            }
        });
    }

    async requestScanMessages(chatData: DataExtractor, messages: BDTLL.IExtractedMessage[]): Promise<BDTLL.IScannedMessage[]> {
        const plainMessages: BDTLL.IExtractedMessage[] = messages.map((message: BDTLL.IExtractedMessage) => {
            return {
                sender: message.sender,
                text: message.text,
                timestamp: message.timestamp
            };
        });

        if (plainMessages.length === 0) {
            return [];
        }

        const conversationStatus: BDTLL.IScannedMessage[] = await BDTLL.MessageService.messageBackground({
            command: BDTLL.Command.SCAN_MESSAGES,
            smsConversation: {
                messages: plainMessages,
                platform: chatData.platform,
                userResponded: chatData.userResponded,
                contactSaved: chatData.knownContact,
                isGroupChat: chatData.isGroupChat
            },
        }) as BDTLL.IScannedMessage[];

        for (const message of conversationStatus) {
            const hash: string = await this.hashText(message.text);
            this.messagesPendingScan.delete(hash);
        }

        const encryptedMessages: BDTLL.IScannedMessage[] = await this.hashExtractedMessages(conversationStatus);
        return encryptedMessages;
    }

    async hashExtractedMessages(messages: BDTLL.IScannedMessage[]): Promise<BDTLL.IScannedMessage[]> {
        const hashedMessages: BDTLL.IScannedMessage[] = await Promise.all(messages.map(async (message: BDTLL.IScannedMessage) => {
            return {
                sender: await this.hashText(message.sender),
                text: await this.hashText(message.text),
                url: message.url,
                status: message.status
            };
        }));

        return hashedMessages;
    }

    async hashText(message: string): Promise<string> {
        const encoder = new TextEncoder();
        const data = encoder.encode(message);
        const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);

        return btoa(new Uint8Array(hashBuffer).join(''));
    }
}