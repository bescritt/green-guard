/*
 * Created by Sergiu Stefan Turlea on Mon Sep 24 2018.
 *
 * Copyright (c) 2018 Bitdefender. All rights reserved.
 */

import * as BDTLL from "../BDTLL";
import { ConfigSentry } from "../common/sentryService";
import Browser = require("webextension-polyfill");

// Variable to keep track if the user did enable the extension or not.
// If the extension did start because of clean install/update/browser restart, the specific callbacks will be called.
// Otherwise, the user did enable the extension manually.
let userDidEnable: boolean = true;

// Missing host = `BDTLL.NATIVE_COMMUNICATION_APP_NAME` is missing
// 3 minutes on debug, 4 hours on release
const SEND_PERMISSIONS_STATUS_INTERVAL_WHEN_MISSING_HOST: number = BDTLL.DEBUG_MODE ? 3 * 60 * 1000 : 4 * 60 * 60 * 1000;

// Service unavailable = `BDTLL.NATIVE_COMMUNICATION_APP_NAME` received the message, but it was not able to process it correctly
// 1 minute on debug, 5 minutes on release
const SEND_PERMISSIONS_STATUS_INTERVAL_WHEN_SERVICE_UNAVAILABLE: number = BDTLL.DEBUG_MODE ? 1 * 60 * 1000 : 5 * 60 * 1000;

// Keep track of the repetitive task that is trying to send the permissions status to app.
let sendPermissionsStatusTask: NodeJS.Timeout;

const handleServiceStatusResponse = (serviceStatus: number) => {
    if (serviceStatus == -2) {
        clearInterval(sendPermissionsStatusTask);

        if (BDTLL.DEBUG_MODE) {
            console.log(
                `Missing host -> will send permissions status every ${SEND_PERMISSIONS_STATUS_INTERVAL_WHEN_MISSING_HOST / 1000 / 60} minutes.`
            );
        }

        sendPermissionsStatusTask = setInterval(
            sendPermissionsStatusTaskCallback,
            SEND_PERMISSIONS_STATUS_INTERVAL_WHEN_MISSING_HOST
        );
    } else if (serviceStatus == -1) {
        clearInterval(sendPermissionsStatusTask);

        if (BDTLL.DEBUG_MODE) {
            console.log(
                `Service unavailable -> will send permissions status every ${SEND_PERMISSIONS_STATUS_INTERVAL_WHEN_SERVICE_UNAVAILABLE / 1000 / 60} minutes.`
            );
        }

        sendPermissionsStatusTask = setInterval(
            sendPermissionsStatusTaskCallback,
            SEND_PERMISSIONS_STATUS_INTERVAL_WHEN_SERVICE_UNAVAILABLE
        );
    } else {
        if (BDTLL.DEBUG_MODE) {
            console.log(`--- Will clear the timer ---`);
        }

        clearInterval(sendPermissionsStatusTask);
    }
};

const sendPermissionsStatusTaskCallback = async () => {
    const userAgreementStatus: BDTLL.UserAgreementPermissionsStatus = (
        await Browser.storage.local.get(BDTLL.LocalStorageKeys.USER_AGREEMENT_STATUS_PD)
    )[BDTLL.LocalStorageKeys.USER_AGREEMENT_STATUS_PD];

    if (userAgreementStatus == undefined) {
        return;
    }

    let permissionsStatus: BDTLL.PermissionsStatus = BDTLL.PermissionsStatus.PERMISSIONS_DENIED;
    if (userAgreementStatus & BDTLL.UserAgreementPermissionsStatus.GRANTED) {
        permissionsStatus = BDTLL.PermissionsStatus.PERMISSIONS_GRANTED;
    }

    const serviceStatus: number = await sendPermissionsStatus(permissionsStatus);
    if (serviceStatus == 0) {
        console.log(`sendPermissionsStatusTaskCallback() -> will clear the timer`);
        clearInterval(sendPermissionsStatusTask);
    }
};

/// Returns:
///     * -2: missing host
///     * -1: service unavailable
///     * 0: OK
const sendPermissionsStatus = async (status: BDTLL.PermissionsStatus): Promise<number> => {
    const message: BDTLL.INativeMessage = {
        request: BDTLL.NativeAppMessageRequestType.PERMISSIONS_STATUS,
        browser: BDTLL.Utils.getCurrentBrowser(),
        permissionsStatus: status,
    };

    if (BDTLL.DEBUG_MODE) {
        console.log(`Will send permissions status to HOST: ${JSON.stringify(message, null, 4)}`);
    }

    try {
        const response: BDTLL.INativeResponse = await Browser.runtime.sendNativeMessage(BDTLL.NATIVE_COMMUNICATION_APP_NAME, message);

        if (BDTLL.DEBUG_MODE) {
            console.log(`sendPermissionsStatus(): Received response: ${JSON.stringify(response, null, 4)}`);
        }

        return response.serviceStatus;
    } catch (error) {
        if (BDTLL.DEBUG_MODE) {
            console.warn(`sendPermissionsStatus(): Could not send status with error: ${error}`);
        }

        return -2;
    }
};

const createPermissionsTab = () => {
    Browser.tabs.create({
        url: "pages/permissions/permissions.html"
    }).then((tab: Browser.Tabs.Tab) => {
        Browser.storage.local.set({
            [BDTLL.LocalStorageKeys.USER_AGREEMENT_TAB_ID]: tab.id
        }).catch((error: Error) => {
            if (BDTLL.DEBUG_MODE) {
                console.warn(`Failed to set ${tab.id} with error: ${error}`);
            }
        });
    }).catch((error: Error) => {
        if (BDTLL.DEBUG_MODE) {
            console.warn(`Could not create tab with error: ${error}`);
        }
    });
};

const isTabAvailable = async (tabId: number): Promise<Browser.Tabs.Tab | undefined> => {
    try {
        return (await Browser.tabs.get(tabId));
    } catch (error) {
        if (BDTLL.DEBUG_MODE) {
            console.warn(`Could not find tab with ID ${tabId}: ${error}`);
        }

        return undefined;
    }
};

const focusTabId = (tabId: number) => {
    Browser.tabs.update(
        tabId,
        { active: true },
    ).then(() => {
        if (BDTLL.DEBUG_MODE) {
            console.log(`Tab with ID ${tabId} focused succesfully`);
        }
    }).catch((error: Error) => {
        if (BDTLL.DEBUG_MODE) {
            console.warn(`Failed to focus on tab with ID ${tabId}: ${error}`);
        }
    });
};

const showPermissionsTab = async (onStartup: boolean = false) => {
    const userAgreementTabId: BDTLL.UserAgreementPermissionsStatus = (
        await Browser.storage.local.get(BDTLL.LocalStorageKeys.USER_AGREEMENT_TAB_ID)
    )[BDTLL.LocalStorageKeys.USER_AGREEMENT_TAB_ID];

    const isPermissionsTabAvailable: Browser.Tabs.Tab = await isTabAvailable(+userAgreementTabId);

    if (userAgreementTabId != undefined && !onStartup && isPermissionsTabAvailable != undefined) {
        focusTabId(userAgreementTabId);
    } else {
        createPermissionsTab();
    }
};

const browserActionOnClickedListener = async () => {
    await showPermissionsTab();
};

const localStorageOnChangedListener = async (changes: { [key: string]: Browser.Storage.StorageChange }) => {
    const changedKeys: string[] = Object.keys(changes);

    if (!changedKeys.includes(BDTLL.LocalStorageKeys.USER_AGREEMENT_STATUS_PD)) {
        return;
    }

    const userAgreementNewStatus: BDTLL.UserAgreementPermissionsStatus = changes[BDTLL.LocalStorageKeys.USER_AGREEMENT_STATUS_PD].newValue;
    const shouldStartExtension: boolean = (userAgreementNewStatus == BDTLL.UserAgreementPermissionsStatus.GRANTED);
    const userAgreementTabId: BDTLL.UserAgreementPermissionsStatus = (
        await Browser.storage.local.get(BDTLL.LocalStorageKeys.USER_AGREEMENT_TAB_ID)
    )[BDTLL.LocalStorageKeys.USER_AGREEMENT_TAB_ID];

    if (
        (userAgreementNewStatus & BDTLL.UserAgreementPermissionsStatus.GRANTED) ||
        (userAgreementNewStatus & BDTLL.UserAgreementPermissionsStatus.DENIED)
    ) {
        Browser.tabs.remove(
            userAgreementTabId
        ).then(() => {
            Browser.storage.local.remove(
                BDTLL.LocalStorageKeys.USER_AGREEMENT_TAB_ID
            ).catch((error: Error) => {
                if (BDTLL.DEBUG_MODE) {
                    console.warn(
                        `Could not remove ${BDTLL.LocalStorageKeys.USER_AGREEMENT_TAB_ID} key from local storage with error: ${error}`
                    );
                }
            });
        }).catch((error: Error) => {
            if (BDTLL.DEBUG_MODE) {
                console.warn(
                    `Could not remove tab (id = ${userAgreementTabId}) with error: ${error}`
                );
            }
        });
    } else if (userAgreementNewStatus & BDTLL.UserAgreementPermissionsStatus.GRANTED_FROM_BROWSER_EXTENSION_POPUP) {
        Browser.tabs.reload(
            userAgreementTabId
        ).catch((error: Error) => {
            if (BDTLL.DEBUG_MODE) {
                console.warn(
                    `Failed to reload tab with id: ${userAgreementTabId} with error: ${error}`
                );
            }
        });
    }

    if (shouldStartExtension) {
        await BDTLL.Utils.reloadAllTabs();
        await BDTLL.Utils.closeTabWithUrlContaining("bdtllff.html");

        startExtension();
    }
};

const runtimeOnInstalledListener = async (details: Browser.Runtime.OnInstalledDetailsType) => {
    if (BDTLL.DEBUG_MODE) {
        console.log(`onInstalled() with details: ${JSON.stringify(details, null, 4)}`);
    }

    userDidEnable = false;

    const installReason: Browser.Runtime.OnInstalledReason = details.reason;

    if (installReason === "install") {
        // For a clean install, we set permissions status to `DENIED` by default.
        await Browser.storage.local.set({
            [BDTLL.LocalStorageKeys.USER_AGREEMENT_STATUS_PD]: BDTLL.UserAgreementPermissionsStatus.DENIED
        });

        Browser.storage.local.onChanged.addListener(
            localStorageOnChangedListener
        );

        Browser.browserAction.onClicked.addListener(
            browserActionOnClickedListener
        );

        const serviceStatus: number = await sendPermissionsStatus(BDTLL.PermissionsStatus.PERMISSIONS_DENIED);
        handleServiceStatusResponse(serviceStatus);

        await showPermissionsTab();
    } else {
        // Update
        const userAgreementStatus: BDTLL.UserAgreementPermissionsStatus = (
            await Browser.storage.local.get(BDTLL.LocalStorageKeys.USER_AGREEMENT_STATUS_PD)
        )[BDTLL.LocalStorageKeys.USER_AGREEMENT_STATUS_PD];

        let willShowPermissionsTab: boolean = true;
        if (userAgreementStatus == undefined) {
            // If the key is not in local storage -> set permissions to `GRANTED` and start extension
            await Browser.storage.local.set({
                [BDTLL.LocalStorageKeys.USER_AGREEMENT_STATUS_PD]: BDTLL.UserAgreementPermissionsStatus.GRANTED
            });

            willShowPermissionsTab = false;
        } else if (userAgreementStatus & BDTLL.UserAgreementPermissionsStatus.GRANTED) {
            // The key is in local storage and set to `GRANTED` -> start extension
            willShowPermissionsTab = false;
        } else {
            // The key is in local storage but not set to `GRANTED` -> show permissions tab
            willShowPermissionsTab = true;
        }

        if (willShowPermissionsTab) {
            Browser.storage.local.onChanged.addListener(
                localStorageOnChangedListener
            );

            Browser.browserAction.onClicked.addListener(
                browserActionOnClickedListener
            );

            await showPermissionsTab(true);
        } else {
            startExtension();
        }
    }
};

const runtimeOnStartupListener = async () => {
    userDidEnable = false;

    await onStartup();
};

const onStartup = async () => {
    const userAgreementStatus: BDTLL.UserAgreementPermissionsStatus = (
        await Browser.storage.local.get(BDTLL.LocalStorageKeys.USER_AGREEMENT_STATUS_PD)
    )[BDTLL.LocalStorageKeys.USER_AGREEMENT_STATUS_PD];

    if (!BDTLL.Utils.checkUserAgreement(userAgreementStatus)) {
        Browser.storage.local.onChanged.addListener(
            localStorageOnChangedListener
        );

        Browser.browserAction.onClicked.addListener(
            browserActionOnClickedListener
        );

        const serviceStatus: number = await sendPermissionsStatus(BDTLL.PermissionsStatus.PERMISSIONS_DENIED);
        handleServiceStatusResponse(serviceStatus);

        await showPermissionsTab(true);
    } else {
        startExtension();
    }
};

const configPopup = () => {
    if (BDTLL.DEBUG_MODE) {
        console.log(`Config popup page...`);
    }

    Browser.browserAction.setIcon({
        path: "img/Ico_Bar_Green.png",
    });

    Browser.browserAction.setPopup({
        popup: "pages/popup/popup.html",
    });
};

const startExtension = async () => {
    Browser.storage.local.onChanged.removeListener(
        localStorageOnChangedListener
    );

    Browser.browserAction.onClicked.removeListener(
        browserActionOnClickedListener
    );

    const assl: BDTLL.Assl = new BDTLL.Assl();
    const scanner: BDTLL.Scanner = new BDTLL.Scanner(assl);
    const whitelist: BDTLL.Whitelist = new BDTLL.Whitelist();
    const update: BDTLL.Update = new BDTLL.Update(scanner, assl);
    const session: BDTLL.Session = new BDTLL.Session(whitelist, scanner);
    const intercepter: BDTLL.InterceptRequests = new BDTLL.InterceptRequests(session);
    const settings: BDTLL.Settings = new BDTLL.Settings([intercepter, session]);

    const userAgreementStatusAD: BDTLL.UserAgreementPermissionsStatus = (
        await Browser.storage.local.get(BDTLL.LocalStorageKeys.USER_AGREEMENT_STATUS_AD)
    )[BDTLL.LocalStorageKeys.USER_AGREEMENT_STATUS_AD];

    if (BDTLL.Utils.checkUserAgreement(userAgreementStatusAD)) {
        if (BDTLL.DEBUG_MODE) {
            console.log(`Anonymous data collection accepted!`);
        }

        // Sentry configuration
        ConfigSentry();
    }

    // Popup configuration
    configPopup();

    const serviceStatus: number = await sendPermissionsStatus(BDTLL.PermissionsStatus.PERMISSIONS_GRANTED);
    handleServiceStatusResponse(serviceStatus);
};

const main = async () => {
    if (BDTLL.Utils.getCurrentBrowser() == BDTLL.BrowserType.FIREFOX) {
        // Register to onStartup events
        Browser.runtime.onStartup.addListener(runtimeOnStartupListener);

        // Register for onInstalled events
        Browser.runtime.onInstalled.addListener(runtimeOnInstalledListener);

        // In case user enabled the extension -> do the onStartup routine
        setTimeout(async () => {
            if (userDidEnable) {
                await onStartup();
            }
        }, 1000);
    } else {
        const assl: BDTLL.Assl = new BDTLL.Assl();
        const scanner: BDTLL.Scanner = new BDTLL.Scanner(assl);
        const whitelist: BDTLL.Whitelist = new BDTLL.Whitelist();
        const update: BDTLL.Update = new BDTLL.Update(scanner, assl);
        const session: BDTLL.Session = new BDTLL.Session(whitelist, scanner);

        await BDTLL.UUID.setUUID();

        if (BDTLL.BUCKET_TESTING_ENABLED) {
            await BDTLL.BucketTesting.updateBucketTestingSettings();
        }

        const intercepter: BDTLL.InterceptRequests = new BDTLL.InterceptRequests(session);
        const settings: BDTLL.Settings = new BDTLL.Settings([intercepter, session]);

        import('../facebookMalvertisingWrapper')
            .then(() => {
                if (BDTLL.DEBUG_MODE) {
                    console.log("Facebook Malvertising module loaded");
                }
            }).catch((error: Error) => {
                if (BDTLL.DEBUG_MODE) {
                    console.error("Error loading Facebook Malvertising:", error);
                }
            });

        ConfigSentry();
    }
};

main();