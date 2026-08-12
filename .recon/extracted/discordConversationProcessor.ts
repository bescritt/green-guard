import { ConversationProcessor } from "./conversationProcessor";
import { IChatAnalyzer } from "../BDTLL_ChatProtection"

export class DiscordConversationProcessor extends ConversationProcessor {
    constructor(userWhitelist: string[], sessionWhitelist: string[], chatAnalyzer: IChatAnalyzer) {
        super(userWhitelist, sessionWhitelist, chatAnalyzer);
    }

    async observerSetup(element: HTMLElement): Promise<void> {
        await super.singleObserverSetup(element);
    }

    processAnchor(hook: HTMLElement): HTMLElement {
        const previousContainer: HTMLElement = hook.querySelector(".BDTLL_MessageContainer");
        if (previousContainer) {
            return previousContainer;
        }

        hook.style.display = "flex";
        const messageContainer: HTMLDivElement = document.createElement('div');
        Array.from(hook.children).forEach((node: HTMLElement) => {
            messageContainer.appendChild(node);
        });

        messageContainer.classList.add("BDTLL_MessageContainer");
        hook.appendChild(messageContainer);

        return messageContainer;
    }
}