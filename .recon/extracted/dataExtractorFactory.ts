import * as BDTLL from "../../../BDTLLCommon";
import * as ChatProtection from "../BDTLL_ChatProtection";

export class DataExtractorFactory {
    static getPlatformSpecificDataExtractor(
        targetElement: HTMLElement,
        chatProtectionSettings: BDTLL.IChatProtectionSettings
    ): ChatProtection.DataExtractor {
        const currentDomain: BDTLL.ChatPlatform = BDTLL.Utils.currentChatPlatform(
            document.location.href
        );

        switch (currentDomain) {
            case BDTLL.ChatPlatform.WHATSAPP:
                return new ChatProtection.WhatsAppDataExtractor(chatProtectionSettings, targetElement);
            case BDTLL.ChatPlatform.FB_MESSENGER:
                return new ChatProtection.MessengerDataExtractor(chatProtectionSettings, targetElement);
            case BDTLL.ChatPlatform.FACEBOOK:
                return new ChatProtection.FacebookDataExtractor(chatProtectionSettings, targetElement);
            case BDTLL.ChatPlatform.TELEGRAM:
                return new ChatProtection.TelegramDataExtractor(chatProtectionSettings, targetElement);
            case BDTLL.ChatPlatform.DISCORD:
                return new ChatProtection.DiscordDataExtractor(chatProtectionSettings, targetElement);
            case BDTLL.ChatPlatform.LINKEDIN:
                return new ChatProtection.LinkedInDataExtractor(chatProtectionSettings, targetElement);
            default:
                throw new Error("Unsupported chat platform");
        }
    }
}