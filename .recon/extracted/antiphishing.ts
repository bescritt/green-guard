/*
 * Created by Sergiu Stefan Turlea on Mon Sep 24 2018.
 *
 * Copyright (c) 2018 Bitdefender. All rights reserved.
 */

import * as BDTLL from "../BDTLL";

class Antiphishing {

    constructor() {
        const info: BDTLL.IRequestInfo = this.gatherInfo();
        this.requestScan(info);
    }

    gatherInfo(): BDTLL.IRequestInfo {
        let domainExtracted: string;
        if (window.location.hostname.split("www.")[1] == null) {
            domainExtracted = window.location.hostname;
        } else {
            domainExtracted = window.location.hostname.split("www.")[1];
        }

        let meta: string = "";
        const metaObj: HTMLCollectionOf<HTMLMetaElement> = document.getElementsByTagName("meta");
        for (let v = 0; v < metaObj.length; v++) {
            for (let i = 0; i < metaObj[v].attributes.length; i++) {
                meta += " " + metaObj[v].attributes[i].value;
            }
        }

        let scripts: string[] = new Array<string>();
        const documentScripts: HTMLCollectionOf<HTMLScriptElement> = document.getElementsByTagName('script');
        for (let s = 0; s < documentScripts.length; s++) {
            try {
                const serializedScript: string = new XMLSerializer().serializeToString(
                    documentScripts.item(s)
                );
                scripts.push(serializedScript);
            } catch (error) {
                if (BDTLL.DEBUG_MODE) {
                    console.log(error);
                }
            }
        }

        const documentIFrames: HTMLCollectionOf<HTMLIFrameElement> = document.getElementsByTagName("iframe");
        for (let f = 0; f < documentIFrames.length; f++) {
            try {
                const serializedScript: string = new XMLSerializer().serializeToString(
                    documentIFrames.item(f)
                );
                scripts.push(serializedScript);
            } catch (error) {
                if (BDTLL.DEBUG_MODE) {
                    console.log(error);
                }
            }
        }

        let url: string;
        const hrefComponents: string[] = location.href.split("#");
        if (hrefComponents.length > 0) {
            url = hrefComponents[0];
        }

        let body: string;
        const htmlTags: HTMLCollectionOf<HTMLHtmlElement> = document.getElementsByTagName("html");
        if (htmlTags.length > 0) {
            body = htmlTags[0].innerHTML.replace(/\s+/g, " ");
        }

        return {
            url: url,
            body: body,
            title: document.title,
            meta: meta,
            domain: domainExtracted,
            scripts: scripts
        }
    }

    requestScan(info: BDTLL.IRequestInfo) {
        if (BDTLL.DEBUG_MODE) {
            console.log("Sending APH request...");
        }
        BDTLL.MessageService.messageBackground({
            command: BDTLL.Command.SCAN_PAGE,
            request: info
        });
    }
}

const APH = new Antiphishing();