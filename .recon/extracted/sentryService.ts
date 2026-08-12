import * as BDTLL from "../BDTLL";
import * as Sentry from "@sentry/browser";
import * as SentryTypes from "@sentry/types";

const filteredErrorsRegEx: string[] = [
    "Non-Error",
    "Missing host",
    "Invalid tab ID",
    "No tab with id",
    "IO error",
    "XMLHttpRequest failed",
    "NetworkError",
    "PrecompiledScript.executeInGlobal",
    "Failed to set icon",
    "Could not load file",
    "XMLSerializer.serializeToString",
    "Permission denied to access property",
    "Cannot access contents of url",
    "Cannot access",
    "illegal character",
    "QuotaExceededError",
    "AbortError",
    "Unknown property name",
    "Error source",
    "missing variable name",
];

const ignoredSentryErrors: string[] = [
    "React is not defined",
    "ReactDOM is not defined",
    "No such native application com.extension.av.communication",
    "browser.runtime.sendNativeMessage is not a function",
    'Attempt to postMessage on disconnected port',
    'Native manifests are not supported on android',
    "Native messaging portal is not available",
    "No matching message handler",
    "Couldn't find a style target. This probably means that the value for the 'insertInto' parameter is invalid.",
    "Message manager disconnected",
    "Missing host permission for the tab",
    "An exception was thrown",
    "too much recursion",
    "regexp too big",
    "An object could not be cloned.",
    "Unknown property name: WebSocket",
    "No error message",
    "Could not establish connection. Receiving end does not exist.",
    "missing } after property list",
    "Maximum call stack size exceeded",
    "The browser is shutting down.",
    "missing catch or finally after try",
    "Promise resolver undefined is not a function",
    "out of memory",
    "expected expression, got '}'",
    "\"\" string literal contains an unescaped line break",
    "config is not defined",
    "class heritage r.Component is not an object or null",
    "sendLog is not defined",
    "0xFF byte doesn't begin a valid UTF-8 code point",
    "modules[moduleId] is undefined",
    "this.contentWindow is null",
    "missing ] in index expression",
    "missing ] after element list",
    "Message manager disconnected",
    "Invalid regular expression: /(\"^item\ao.t|t(b|doe)a?\.co?m(\.).|-{0,50}(/auction/|itedem_ta(ili)t/il|tem\.as/: Unterminated group",
    "Argument 1 of PrecompiledScript.executeInGlobal is not an object.",
    "This event does not support filters",
    "this.scanner.scanLink is not a function",
    "browser.browserAction is undefined",
    "this.internalWhitelist is undefined",
    "browser.browserAction.setIcon is not a function",
    "\"setTimeout\" is read-only",
    "\"addEventListener\" is read-only",
];

/**
 * @description function should be called with entity of type Sentry.Event, but it is left as any as recursive call needs keyof Sentry.Event
 */
const replaceStringInObjectProperties = (entity: any, regExp: RegExp, replacement: string) => {
    for (const property in entity) {
        if (!entity.hasOwnProperty(property)) {
            continue;
        }
        
        let value = entity[property];
        if (typeof value === "object") {
            value = replaceStringInObjectProperties(value, regExp, replacement);
        }
        else if (typeof value === "string") {
            value = value.replace(regExp, replacement);
        }

        try {
            entity[property] = value;
        } catch (error) { }
    }

    return entity;
};

const onBeforeSend = (event: SentryTypes.Event, hint: SentryTypes.EventHint) => {
    if (hint == null) {
        // hint is null or undefined
        return null;
    }

    const regExp: RegExp = new RegExp("[a-z]+-extension\:\/\/[^\/]+\/", 'gi' );
    event = replaceStringInObjectProperties(event, regExp, "extension://trafficlight/");

    const error: Error | string = hint.originalException;
    let errorMessage: string | undefined;

    if (typeof error === 'string') {
        errorMessage = error;
    } else if (error instanceof Error && error.message) {
        errorMessage = error.message;
    }

    if (errorMessage == null) {
        // errorMessage is null or undefined
        return null;
    }

    if (event.exception.values == null || event.exception.values[0].value == null) {
        return null;
    }

    const eventException: string = event.exception.values[0].value;
    for (const errorRegEx of filteredErrorsRegEx) {
        if (errorMessage.startsWith(errorRegEx)) {
            return null;
        }

        if (eventException.startsWith(errorRegEx)) {
            return null;
        }
    }

    return event;
};

export const ConfigSentry = () => {
    Sentry.init({
        dsn: 'https://5ce74beb56cb4b8b97c847bd776ce6db@catch-nimbus.bitdefender.net/144',
        debug: (process.env.ENVIRONMENT !== "production"),
        release: `${BDTLL.Consts.COMPANY_NAME}-${BDTLL.Consts.PRODUCT_NAME}-${process.env.ENVIRONMENT}-mv3@${BDTLL.Consts.VERSION}`,
        dist: process.env.DIST,
        environment: process.env.ENVIRONMENT,
        sampleRate: process.env.ENVIRONMENT !== "production" ? 1.0 : 0.1,
        attachStacktrace: true,
        beforeSend: onBeforeSend,
        ignoreErrors: ignoredSentryErrors,
    });
};