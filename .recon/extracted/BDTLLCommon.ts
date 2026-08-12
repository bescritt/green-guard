/*
 * Created by Sergiu Stefan Turlea on Mon Sep 24 2018.
 *
 * Copyright (c) 2018 Bitdefender. All rights reserved.
 */

export {
    REPORT_SCANNED_PAGES_TIME_INTERVAL, MALVERTISING_ENABLED_DEFAULT_VALUE,
    DEBUG_MODE, SCREEN_UI, CLOUD_SERVER, BUCKET_TESTING_ENABLED, CloudServices,
    NATIVE_COMMUNICATION_APP_NAME, NativeAppMessageRequestType, PermissionsStatus,
    Consts, CloudEndpoints, SearchEngine, Command, PageStatus,
    StorageKeys, StatusIcon, StatusGif, BarIcon, SettingType,
    UserAgreementPermissionsStatus, UserAgreementPermissionsStep, UserAgreementPermissionsLoadingLocation,
    LocalStorageKeys, toBarIcon, StatusPriority, MaliciousStatuses, ChatPlatform, Features
} from "./common/extensionConsts";
export { BrowserConsts } from "./common/browserConsts";
export { Utils, BrowserType } from "./common/utils";
export { ReactUtils } from "./common/reactUtils";
export { MessageService, IChatProtectionSettings } from "./common/messageService";
export { IExtractedMessage } from "./content/chatProtection/dataExtractors/dataExtractor"
export { WebPage } from "./background/session"
export { IStoredConversationStatus, IScannedMessage, IChatResult } from "./content/chatProtection/chatAnalyzer"