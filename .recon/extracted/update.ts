/*
 * Created by Sergiu Stefan Turlea on Mon Sep 24 2018.
 *
 * Copyright (c) 2018 Bitdefender. All rights reserved.
 */

import * as BDTLL from "../BDTLL";
import Browser = require("webextension-polyfill");

export class Update {
	scanner: BDTLL.IScanner;
	assl: BDTLL.IAssl;
	interval = 14400000; // 4 hours between updates
	intervalInMInutes = 240;  // 4 hours between updates (in minutes)

	constructor(scanner: BDTLL.IScanner, assl: BDTLL.IAssl) {
		this.scanner = scanner;
		this.assl = assl;
		this.checkUpdate();

		if (BDTLL.Utils.getCurrentBrowser() == BDTLL.BrowserType.FIREFOX) {
			setInterval(this.checkUpdate.bind(this), this.interval);
		} else {
			Browser.alarms.get("tll-update-timer").then((alarm: Browser.Alarms.Alarm) => {
				if (typeof (alarm) === "undefined") {
					// Move timers to alarms in service workers:
					// https://developer.chrome.com/docs/extensions/mv3/migrating_to_service_workers/#alarms
					Browser.alarms.create(
						"tll-update-timer",
						{
							// length of time after which the `onAlarm` event is fired for the first time.
							delayInMinutes: this.intervalInMInutes,
							// the `onAlarm` event should fire every `periodInMinutes` minutes after first initial event.
							periodInMinutes: this.intervalInMInutes,
						}
					)
				} else {
					if (BDTLL.DEBUG_MODE) {
						console.log("tll-update-timer already registered!");
					}
				}
			});
		}

		this.listen();
	}

	async checkUpdate(): Promise<number> {
		try {
			const currentTime: number = (new Date()).getTime();
			const storedTime: number = parseInt(await BDTLL.Storage.get(BDTLL.StorageKeys.TIME) as string);

			if (!(isNaN(storedTime) || storedTime + this.interval < currentTime))
				return 0;

			BDTLL.Storage.set(BDTLL.StorageKeys.TIME, currentTime);

			if (BDTLL.Utils.getCurrentBrowser() == BDTLL.BrowserType.FIREFOX) {
				this.updateFirefox();
			} else {
				this.updateChrome();
			}
		} catch (error) { }
	}

	async updateFirefox(): Promise<void> {
		const date: Date = new Date();
		BDTLL.Storage.set('date', date.toLocaleDateString());

		this.requestInfoFirefox("ph_sign.slf").then(async (xhr: XMLHttpRequest) => {
			BDTLL.Storage.set("slfContent", xhr.responseText);
			await this.assl.createRegexes();
		}).catch((error: Error) => {
			if (BDTLL.DEBUG_MODE) {
				console.log(error);
			}
		});

		this.requestInfoFirefox("ph_white.txt").then((xhr: XMLHttpRequest) => {
			BDTLL.Storage.set("internalWhitelist", xhr.responseText).then(() => {
				this.scanner.internalWhitelist = xhr.responseText.split("\n");
			}).catch((error: Error) => {
				if (BDTLL.DEBUG_MODE) {
					console.log(error);
				}
			});
		}).catch((error: Error) => {
			if (BDTLL.DEBUG_MODE) {
				console.log(error);
			}
		});
	}

	async updateChrome(): Promise<void> {
		const date: Date = new Date();
		BDTLL.Storage.set(BDTLL.StorageKeys.DATE, date.toLocaleDateString());

		this.requestInfoChrome("ph_sign.slf")
			.then((response: Response) => response.text())
			.then(async (body: string) => {
				BDTLL.Storage.set(BDTLL.StorageKeys.SLF_CONTENT, body);
				await this.assl.createRegexes();
			})
			.catch((error: Error) => {
				if (BDTLL.DEBUG_MODE) {
					console.log(error);
				}
			});

		this.requestInfoChrome("ph_white.txt")
			.then((response: Response) => response.text())
			.then((body: string) => {
				BDTLL.Storage.set(BDTLL.StorageKeys.INTERNAL_WHITELIST, body).then(() => {
					this.scanner.internalWhitelist = body.split("\n");
				}).catch((error: Error) => {
					if (BDTLL.DEBUG_MODE) {
						console.log(error);
					}
				});
			}).catch((error: Error) => {
				if (BDTLL.DEBUG_MODE) {
					console.log(error);
				}
			});
	}

	requestInfoChrome(filename: string): Promise<Response > {
		const fetchPromise = fetch(
			`https://nimbus.bitdefender.net/tll/update?file=${filename}`,
			{
				method: 'GET',
				headers: {
					'X-Nimbus-ClientId': BDTLL.BrowserConsts.BROWSER_CLIENTID || '',
				}
			}
		);

		return fetchPromise;
	}

	requestInfoFirefox(filename: string): Promise<XMLHttpRequest | void> {
		const sURL: string = 'https://nimbus.bitdefender.net/tll/update?file=' + filename;
		const oRequest = BDTLL.Utils.xHTTPRequest();
		oRequest.nativeXhr.open("GET", sURL, true);

		if (BDTLL.BrowserConsts) {
			oRequest.nativeXhr.setRequestHeader("X-Nimbus-ClientId", BDTLL.BrowserConsts.BROWSER_CLIENTID || "");
		}

		return oRequest.send();
	}

	listen(): void {
		BDTLL.MessageService.addListener(
			(message: BDTLL.IMessage) => {
				if (message.command == BDTLL.Command.GET_LAST_UPDATE) {
					return BDTLL.Storage.get(BDTLL.StorageKeys.DATE);
				}
			}
		);

		if (BDTLL.Utils.getCurrentBrowser() != BDTLL.BrowserType.FIREFOX) {
			Browser.alarms.onAlarm.addListener((alarm: Browser.Alarms.Alarm) => {
				if (alarm.name === "tll-update-timer") {
					if (BDTLL.DEBUG_MODE) {
						console.log("Check updates...");
					}
					this.checkUpdate();
				}
			});
		}
	}
}