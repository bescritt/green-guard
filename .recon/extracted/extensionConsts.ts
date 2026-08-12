/*
 * Created by Sergiu Stefan Turlea on Mon Sep 24 2018.
 *
 * Copyright (c) 2018 Bitdefender. All rights reserved.
 */

export const DEBUG_MODE: boolean = (process.env.ENVIRONMENT !== 'production');
export const REPORT_SCANNED_PAGES_TIME_INTERVAL: number = (process.env.ENVIRONMENT !== 'production' ? 1 : 5);  // time interval expressed in minutes
export const MALVERTISING_ENABLED_DEFAULT_VALUE: boolean = process.env.MALVERTISING_ENABLED_DEFAULT_VALUE === 'true' ? true : false;
export const BUCKET_TESTING_ENABLED: boolean = process.env.BUCKET_TESTING_ENABLED === 'true' ? true : false;

export const CLOUD_SERVER: string = "[CloudServer]"

export const NATIVE_COMMUNICATION_APP_NAME: string = "com.extension.av.communication";

export enum CloudServices {
    SMS_MESSAGE_FILTER_ENDPOINT = "lambada/osx/scam_alert",
    NIMBUS_UUID_GENERATION_ENDPOINT = "services/genid"
}

export enum Consts {
    //VERSION
    VERSION = "[Version]",

    // base url to open when clicking on a search results button
    SEARCH_INFO_URL = "[SearchInfoUrl]",
    FEEDBACK_URL = "[FeedbackUrl]",

    // Privacy policy url
    PRIVACY_POLICY_URL = "[PrivacyPolicyUrl]",

    // Default locale
    DEFAULT_LOCALE = "[DefaultLocale]",

    // Branding
    COMPANY_NAME = "[CompanyName]",
    PRODUCT_NAME = "[ProductName]",
}

export enum CloudEndpoints {
    // endpoint for checking the status of a single url
    URL_STATUS = "url/status",

    // endpoint for checking the status of multiple urls
    URL_BATCH_STATUS = "batch/url/status",

    // endpoint for getting settings for A/B testing
    BUCKET_TESTING = "bucket-testing"
}

export enum StorageKeys {
    // date of the last update used as info when reporting new phishing pages
    DATE = "date",
    // stored time to check for new updates
    TIME = "time",

    // whitelisted domains by the user
    USER_WHITELIST = "userWhitelist",
    // whitelisted domains when user used the 'take me there anyway' button
    SESSION_WHITELIST = "sessionWhitelist",
    // whitelisted domains got from server
    INTERNAL_WHITELIST = "internalWhitelist",

    // list of different regexes for page scanning
    SLF_CONTENT = "slfContent",

    // keeps track of the scanned pages
    TLL_SP = "tll_sp",

    // last malvertising status from the service
    LAST_MALVERTISING_STATUS = "lastMalvStatus",

    // stored setting buckets
    CURRENT_BUCKETS = "currentBuckets",

    // last valid server response
    BUCKET_TESTING_SETTINGS = "lastValidServerResponse",
    // last bucket testing request time
    LAST_BUCKET_TESTING_REQUEST_TIME = "lastBucketTestingRequestTime",

    // cached statuses of scanned sms conversations
    SCANNED_MESSAGES = "scannedMessages",

    // user UUID used for API telemetry
    UUID = "userUniqueIdentifier"
};

export enum LocalStorageKeys {
    // Local Storage Keys regarding the user agreement
    USER_AGREEMENT_STATUS_PD = "user_agreement_status_pd",
    USER_AGREEMENT_STATUS_AD = "user_agreement_status_ad",
    USER_AGREEMENT_TAB_ID = "user_agreement_tab_id",
};

export enum PermissionsStatus {
    PERMISSIONS_DENIED = -1,
    PERMISSIONS_GRANTED = 0,
};

export enum UserAgreementPermissionsStatus {
    // User didn't agree to our privacy policy
    DENIED = 1,
    // User agreed to our privacy policy and reloaded the extension
    GRANTED = 2,
    // User agreed the privacy policy from the permissions tab created by the extension (but not reloaded yet)
    GRANTED_FROM_BROWSER_TAB = 4,
    // User agreed the privacy policy from the extension popup (but not reloaded yet)
    GRANTED_FROM_BROWSER_EXTENSION_POPUP = 8,
};

export enum UserAgreementPermissionsLoadingLocation {
    BROWSER_TAB = "tab",
    BROWSER_EXTENSION_POPUP = "popup",
};

export enum UserAgreementPermissionsStep {
    DISCLOSURE = 1,
    SUCCESS = 2,
    UNINSTALL = 4,
};

export enum NativeAppMessageRequestType {
    BLOCKED_PAGES = "blockedPages",
    SCANNED_PAGES = "scannedPages",
    PERMISSIONS_STATUS = "permissionsStatus",
    MALVERTISING_SUPPORT = "malvertisingSupport",
    SCAN_MESSAGES = "scanMessages",
    CHAT_PROTECTION_SETTINGS = "chatprotectionSettings"
};

// Supported search engines
export enum SearchEngine {
    SEARCH_GOOGLE = "google",
    SEARCH_YAHOO = "search.yahoo",
    SEARCH_YAHOO_JP = "search.yahoo.co.jp",
    SEARCH_BING = "bing",
    SEARCH_DUCKDUCKGO = "duckduckgo",
}

export const SCREEN_UI = {
    MAIN : 1,
    FEEDBACK : 2,
    SETTINGS : 4
}

export enum Command {
    // these commands return a boolean
    GET_SETTING,
    WHITELIST_ADD,
    WHITELIST_REMOVE,
    SESSION_WHITELIST,
    CHECK_MALVERTISING_ENABLED,

    //these commands don't return anything
    WHITELIST_ADD_FRONTEND,
    OPEN_FEEDBACK_MESSAGE,
    OPEN_SETTINGS,
    OPEN_FEEDBACK,
    SET_SETTING,
    SET_MESSAGES,

    //these commands return a string[]
    GET_SESSION_WHITELIST,
    GET_WHITELIST,

    //these commands return a BDTLL.WebPage
    GET_PAGE_INFO,
    SCAN_PAGE,
    
    // these returns a BDTLL.PageStatus[]
    SCAN_LINKS, 
    SCAN_MESSAGES,

    GET_MESSAGES, // this returns a Map<string, Map<string, BDTLL.PageStatus>>
    
    GET_LAST_UPDATE, // this returns a string

    GET_CHAT_PROTECTION_SETTINGS
}

export enum PageStatus {
    SAFE = "safe",
    MALWARE = "malware",
    PHISHING = "phishing",
    FRAUD = "fraud",
    MINER = "miner",
    PUA = "pua",
    MALVERTISING = "malvertising",
    SPAM = "spam",
    UNTRUSTED = "untrusted",
    WHITELISTED = "whitelisted",
    SESSION_WHITELISTED = "sessionWhitelisted",
    DISABLED = "disabled",
    SEARCH_ANALYZER_DISABLED = "searchAnalyzerDisabled",
}

export enum StatusIcon {
    SAFE = "BDTLL_icon_ok",
    CRITICAL = "BDTLL_icon_critical",
    ALERT = "BDTLL_icon_alert",
    WHITELISTED = "BDTLL_icon_whitelisted",
    DISABLED = "BDTLL_icon_disabled"
}

export enum StatusGif {
    SAFE = "BDTLL_animation_ok",
    CRITICAL = "BDTLL_animation_blocked",
    ALERT = "BDTLL_animation_blocked",
    WHITELISTED = "BDTLL_animation_disabled",
    DISABLED = "BDTLL_animation_disabled"
}

export enum BarIcon {
    SAFE = "img/Ico_Bar_Green.png",
    CRITICAL = "img/Ico_Bar_Red.png",
    ALERT = "img/Ico_Bar_Yellow.png",
    WHITELISTED = "img/Ico_Bar_Whitelisted.png",
    DISABLED = "img/Ico_Bar_Disabled.png"
}

export enum SettingType {
    THREAT_FILTER = "threatFilter",
    SEARCH_ANALYZER = "searchAnalyzer",
    EXCEPTION_LIST = "exceptionList"
}

export enum ChatPlatform {
    WHATSAPP = "web.whatsapp.com",
    FB_MESSENGER = "www.messenger.com",
    FACEBOOK = "www.facebook.com",
    TELEGRAM = "web.telegram.org",
    DISCORD = "discord.com",
    LINKEDIN = "www.linkedin.com"
}

const StatusPriority = [
    PageStatus.DISABLED,
    PageStatus.WHITELISTED,
    PageStatus.SAFE,
    PageStatus.UNTRUSTED,
    PageStatus.SPAM,
    PageStatus.PUA,
    PageStatus.MINER,
    PageStatus.FRAUD,
    PageStatus.PHISHING,
    PageStatus.MALWARE,
    PageStatus.MALVERTISING,
];

const toBarIcon: {[key in PageStatus]: BarIcon} = {
    [PageStatus.SAFE]: BarIcon.SAFE,
    [PageStatus.DISABLED]: BarIcon.DISABLED,
    [PageStatus.SEARCH_ANALYZER_DISABLED]: BarIcon.DISABLED,
    [PageStatus.WHITELISTED]: BarIcon.WHITELISTED,
    [PageStatus.SESSION_WHITELISTED]: BarIcon.WHITELISTED,
    [PageStatus.SPAM]: BarIcon.ALERT,
    [PageStatus.UNTRUSTED]: BarIcon.ALERT,
    [PageStatus.MALWARE]: BarIcon.CRITICAL,
    [PageStatus.FRAUD]: BarIcon.CRITICAL,
    [PageStatus.PHISHING]: BarIcon.CRITICAL,
    [PageStatus.MINER]: BarIcon.CRITICAL,
    [PageStatus.PUA]: BarIcon.CRITICAL,
    [PageStatus.MALVERTISING]: BarIcon.CRITICAL,
};

const MaliciousStatuses = [
    PageStatus.MALWARE,
    PageStatus.PHISHING,
    PageStatus.FRAUD,
    PageStatus.MINER,
    PageStatus.PUA,
    PageStatus.MALVERTISING,
];

export enum Features {
    CHAT_PROTECTION = "chat_protection"
}

export {StatusPriority, toBarIcon, MaliciousStatuses}
