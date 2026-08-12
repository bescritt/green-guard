import * as BDTLL from "../../../BDTLL";
import * as ChatProtection from "../BDTLL_ChatProtection"

export class ConversationProcessorFactory {
    static getPlatformSpecificConversationProcessor(userWhitelist: string[], sessionWhitelist: string[], chatAnalyzer: ChatProtection.IChatAnalyzer): ChatProtection.ConversationProcessor {
        const currentDomain: BDTLL.ChatPlatform = BDTLL.Utils.currentChatPlatform(
            document.location.href
        );

        switch (currentDomain) {
            case BDTLL.ChatPlatform.WHATSAPP:
                return new ChatProtection.WhatsAppConversationProcessor(userWhitelist, sessionWhitelist, chatAnalyzer);
            case BDTLL.ChatPlatform.FB_MESSENGER:
                return new ChatProtection.FacebookConversationProcessor(userWhitelist, sessionWhitelist, chatAnalyzer);
            case BDTLL.ChatPlatform.FACEBOOK:
                return new ChatProtection.FacebookConversationProcessor(userWhitelist, sessionWhitelist, chatAnalyzer);
            case BDTLL.ChatPlatform.TELEGRAM:
                return new ChatProtection.TelegramConversationProcessor(userWhitelist, sessionWhitelist, chatAnalyzer);
            case BDTLL.ChatPlatform.DISCORD:
                return new ChatProtection.DiscordConversationProcessor(userWhitelist, sessionWhitelist, chatAnalyzer);
            case BDTLL.ChatPlatform.LINKEDIN:
                return new ChatProtection.LinkedInConversationProcessor(userWhitelist, sessionWhitelist, chatAnalyzer);
            default:
                throw new Error("Unsupported chat platform");
        }
    }
}