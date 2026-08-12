import { ConversationProcessor } from "./conversationProcessor";
import { IChatAnalyzer } from "../BDTLL_ChatProtection"

export class TelegramConversationProcessor extends ConversationProcessor {
    VersionWebA: string = "web.telegram.org/a";

    constructor(userWhitelist: string[], sessionWhitelist: string[], chatAnalyzer: IChatAnalyzer) {
        super(userWhitelist, sessionWhitelist, chatAnalyzer);
    }

    async observerSetup(element: HTMLElement): Promise<void> {
        await super.singleObserverSetup(element);
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
        span.classList.add("BDTLL_Span");
        tooltipContainer.appendChild(span);

        const messageContainer: HTMLDivElement = document.createElement('div');
        messageContainer.classList.add("BDTLL_Message_Container");

        if (document.location.href.includes(this.VersionWebA)) {
            tooltipContainer.style.marginRight = "1%";
            tooltipContainer.style.marginTop = "-0.5%";

            messageContainer.style.width = "95%";

            Array.from(hook.children).forEach((node: HTMLElement) => {
                if (node.classList?.contains("message-title")) {
                    return;
                }
                messageContainer.appendChild(node);
            });

            const chatProtectionDiv: HTMLDivElement = document.createElement('div');
            chatProtectionDiv.classList.add("BDTLL_ChatProtection");
            chatProtectionDiv.style.display = "flex";

            chatProtectionDiv.appendChild(tooltipContainer);
            chatProtectionDiv.appendChild(messageContainer);
            hook.appendChild(chatProtectionDiv);
        } else {
            tooltipContainer.style.flex = "none";
            tooltipContainer.style.width = "16px";
            tooltipContainer.style.marginLeft = "2.5%";
            tooltipContainer.style.marginTop = "1.5%";

            hook.style.width = "90%";
            hook.parentElement.insertBefore(messageContainer, hook);

            messageContainer.style.display = "flex";
            messageContainer.appendChild(hook);
            messageContainer.insertBefore(tooltipContainer, hook);
        }

        return span;
    }
}