/*
 * Created by Sergiu Stefan Turlea on Mon Sep 24 2018.
 *
 * Copyright (c) 2018 Bitdefender. All rights reserved.
 */

import * as BDTLL from "../BDTLL";

export interface IWhitelist {
    whitelistAdd(url: string): Promise<boolean>;
    whitelistRemove(url: string): Promise<boolean>;
    getWhitelist(): Promise<Array<string>>;
    isWhitelisted(url: string): boolean;
}

export class Whitelist implements IWhitelist {
    userWhitelist: Array<string>;

    constructor() {
        BDTLL.Storage.get(BDTLL.StorageKeys.USER_WHITELIST).then((list: BDTLL.StorageData) => {
            if (typeof(list) == "string" && list != "") {
                this.userWhitelist = list.split(",");
            } else {
                this.userWhitelist = [];
            }
        }).catch((errorReason: Error) => {
            this.userWhitelist = [];

            if (BDTLL.DEBUG_MODE) {
                console.error(errorReason);
            }
        });

        this.listen();
    }

    async whitelistAdd(url: string): Promise<boolean> {
        const domain: string = BDTLL.Utils.extractRootDomain(url);

        if (domain && this.userWhitelist.indexOf(domain) < 0) {
            this.userWhitelist = this.userWhitelist.concat(domain);
            BDTLL.Storage.set(BDTLL.StorageKeys.USER_WHITELIST, this.userWhitelist.join());
        }

        return true;
    }

    async whitelistRemove(url: string): Promise<boolean> {
        const domain: string = BDTLL.Utils.extractRootDomain(url);

        if (domain && this.userWhitelist.indexOf(domain) > -1) {
            this.userWhitelist.splice(this.userWhitelist.indexOf(domain), 1);
            BDTLL.Storage.set(BDTLL.StorageKeys.USER_WHITELIST, this.userWhitelist.join());
        }

        return true;
    }

    isWhitelisted(url: string): boolean {
        const domain: string = BDTLL.Utils.extractRootDomain(url);

        return this.userWhitelist.indexOf(domain) > -1;
    }

    async getWhitelist(): Promise<Array<string>> {
        return this.userWhitelist;
    }

    listen(): void {
        BDTLL.MessageService.addListener(
            (message: BDTLL.IMessage) => {
                switch (message.command) {
                    case BDTLL.Command.GET_WHITELIST:
                        return this.getWhitelist();
                    case BDTLL.Command.WHITELIST_ADD:
                        return this.whitelistAdd(message.value);
                    case BDTLL.Command.WHITELIST_REMOVE:
                        return this.whitelistRemove(message.value);
                }
            });
    }
}