import * as BDTLL from "../../../BDTLL";
import { ConversationProcessor } from "./conversationProcessor";
import { IChatAnalyzer } from "../BDTLL_ChatProtection";

export class FacebookConversationProcessor extends ConversationProcessor {
    constructor(userWhitelist: string[], sessionWhitelist: string[], chatAnalyzer: IChatAnalyzer) {
        super(userWhitelist, sessionWhitelist, chatAnalyzer);
    }

    async observerSetup(element: HTMLElement): Promise<void> {
        const currentDomain: BDTLL.ChatPlatform = BDTLL.Utils.currentChatPlatform(
            document.location.href
        );

        if (currentDomain === BDTLL.ChatPlatform.FB_MESSENGER) {
            await super.singleObserverSetup(element);
        } else {
            const rootObserver: MutationObserver = new MutationObserver((mutations: MutationRecord[]) => {
                for (const mutation of mutations) {
                    if (mutation.type !== "childList") {
                        continue;
                    }

                    mutation.addedNodes.forEach(async (chatBubble: HTMLElement) => {
                        if (this.elementObservers.has(chatBubble)) {
                            return;
                        }

                        await super.singleObserverSetup(chatBubble);
                    });

                    mutation.removedNodes.forEach((chatBubble: HTMLElement) => {
                        if (this.elementObservers.has(chatBubble)) {
                            this.elementObservers.get(chatBubble).disconnect();
                            this.elementObservers.delete(chatBubble);
                        }
                    });
                }
            });

            const documentObserver: MutationObserver = new MutationObserver(async (mutations: MutationRecord[]) => {
                const chatOverlayRoot: HTMLElement = document.querySelector(
                    "div[id^=\"mount_\"] > div > div:first-child > div > div:last-child > div:first-child > div > div[class*=\" \"]:first-child"
                );

                if (chatOverlayRoot !== null && this.elementObservers.get(chatOverlayRoot) === undefined) {
                    chatOverlayRoot.childNodes.forEach(async (chatBubble: HTMLElement) => {
                        if (this.elementObservers.has(chatBubble)) {
                            return;
                        }

                        await super.singleObserverSetup(chatBubble);
                    });

                    rootObserver.observe(chatOverlayRoot, {
                        childList: true
                    });

                    this.elementObservers.set(chatOverlayRoot, rootObserver);

                    if (this.elementObservers.has(document.body)) {
                        this.elementObservers.get(document.body).disconnect();
                        this.elementObservers.delete(document.body);
                    }
                } else {
                    if (document.location.href.includes("/messages/")) {
                        if (!this.elementObservers.has(document.body)) {
                            await super.singleObserverSetup(document.body);
                        }
                    }
                }
            });

            documentObserver.observe(document, {
                subtree: true,
                childList: true
            });
        }
    }

    processAnchor(hook: HTMLElement): HTMLElement {
        const existingTooltip: HTMLElement = hook.parentElement.querySelector(
            "div.BDTLL_Tooltip_Container > span.BDTLL_Span"
        );

        if (existingTooltip !== null) {
            return existingTooltip;
        }

        const tooltipContainer: HTMLDivElement = document.createElement('div');
        const span: HTMLSpanElement = document.createElement("span");

        tooltipContainer.classList.add("BDTLL_Tooltip_Container");
        tooltipContainer.style.marginRight = "4px";
        tooltipContainer.style.marginLeft = "-3px";
        tooltipContainer.style.marginTop = "6px";

        span.classList.add("BDTLL_Span");
        tooltipContainer.appendChild(span);

        hook.parentElement.parentElement.style.maxWidth = "100%";
        hook.parentElement.parentElement.style.flexGrow = "1";

        hook.parentElement.style.display = "flex";
        hook.parentElement.insertBefore(tooltipContainer, hook);

        return span;
    }
}