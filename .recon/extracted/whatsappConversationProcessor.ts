import { ConversationProcessor } from "./conversationProcessor";
import { IChatAnalyzer } from "../BDTLL_ChatProtection"

export class WhatsAppConversationProcessor extends ConversationProcessor {
    constructor(userWhitelist: string[], sessionWhitelist: string[], chatAnalyzer: IChatAnalyzer) {
        super(userWhitelist, sessionWhitelist, chatAnalyzer);
    }

    async observerSetup(element: HTMLElement): Promise<void> {
        await super.singleObserverSetup(element);
    }

    processAnchor(hook: HTMLElement): HTMLElement {
        const previousAnchor: HTMLElement = hook.parentElement.parentElement.querySelector(
            "div.BDTLL_Tooltip_Container > span.BDTLL_Span"
        );

        if (previousAnchor !== null) {
            return previousAnchor;
        }

        const tooltipContainer = document.createElement('div');
        const span = document.createElement("span");

        tooltipContainer.classList.add("BDTLL_Tooltip_Container");
        span.classList.add("BDTLL_Span");
        tooltipContainer.appendChild(span);

        hook.style.display = "flex";
        const messageContainer: HTMLDivElement = document.createElement('div');
        Array.from(hook.children).forEach((node: HTMLElement) => {
            messageContainer.appendChild(node);
        });
        messageContainer.style.marginLeft = "1%";

        // message with gif or reply box
        if (messageContainer.querySelector("div[role='button']")) {
            const timeElement: HTMLElement = messageContainer.lastElementChild as HTMLElement;

            if (timeElement && !timeElement.querySelector(":scope > span.copyable-text")) {
                timeElement.style.left = "91.5%";
                timeElement.style.width = "10%";
            }

            if (messageContainer.querySelector('img,div[style*="background-image: url(data:image/"]')) {
                hook.parentElement.style.width = "106%";
                const reactionPopup: HTMLElement = hook.parentElement.nextElementSibling as HTMLElement;
                if (reactionPopup) {
                    reactionPopup.style.left = "106%";
                }
            }

            messageContainer.style.width = "96%";
            messageContainer.style.marginLeft = "1%";

            tooltipContainer.style.margin = "3px";
            tooltipContainer.style.marginLeft = "5px";
            tooltipContainer.style.marginTop = "6px";
        } else if (messageContainer.children.length > 1) {
            messageContainer.style.width = "90%";
            messageContainer.style.marginLeft = "3%";

            tooltipContainer.style.marginTop = "6px";
            tooltipContainer.style.marginLeft = "-3px";
        }

        messageContainer.classList.add("BDTLL_MessageContainer");
        hook.appendChild(tooltipContainer);
        hook.appendChild(messageContainer);

        return span;
    }
}