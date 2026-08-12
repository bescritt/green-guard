/*
 * Created by Sergiu Stefan Turlea on Mon Sep 24 2018.
 *
 * Copyright (c) 2018 Bitdefender. All rights reserved.
 */

import * as React from "react";
import * as ReactDOM from "react-dom";
import * as BDTLL from "../../BDTLLCommon";
import { ErrorBoundary } from "../components/errorBoundary";

interface IThreatBlockedProps {
    status: BDTLL.PageStatus;
    url: string;
}

interface IThreatBlockedState {
    showToast?: string;
    title: string;
    text: string;
}

type BlockedPageDetails = {
    [key in BDTLL.PageStatus]: IThreatBlockedState
}

const BlockedDetails: BlockedPageDetails = {
    [BDTLL.PageStatus.MALWARE]: {
        title: BDTLL.Utils.getLocalizedText("blocked_title_malware"),
        text: BDTLL.Utils.getLocalizedText("blocked_text_malware")
    },
    [BDTLL.PageStatus.PHISHING]: {
        title: BDTLL.Utils.getLocalizedText("blocked_title_phish"),
        text: BDTLL.Utils.getLocalizedText("blocked_text_phish")
    },
    [BDTLL.PageStatus.FRAUD]: {
        title: BDTLL.Utils.getLocalizedText("blocked_title_fraud"),
        text: BDTLL.Utils.getLocalizedText("blocked_text_fraud")
    },
    [BDTLL.PageStatus.MINER]: {
        title: BDTLL.Utils.getLocalizedText("blocked_title_miner"),
        text: BDTLL.Utils.getLocalizedText("blocked_text_miner")
    },
    [BDTLL.PageStatus.PUA]: {
        title: BDTLL.Utils.getLocalizedText("blocked_title_pua"),
        text: BDTLL.Utils.getLocalizedText("blocked_text_pua")
    },
    [BDTLL.PageStatus.MALVERTISING]: {
        title: BDTLL.Utils.getLocalizedText("blocked_title_malvertising"),
        text: BDTLL.Utils.getLocalizedText("blocked_text_malvertising")
    },
    [BDTLL.PageStatus.SPAM]: {
        title: BDTLL.Utils.getLocalizedText("blocked_title_untrusted"),
        text: BDTLL.Utils.getLocalizedText("blocked_text_untrusted")
    },
    [BDTLL.PageStatus.UNTRUSTED]: {
        title: BDTLL.Utils.getLocalizedText("blocked_title_untrusted"),
        text: BDTLL.Utils.getLocalizedText("blocked_text_untrusted")
    },
    [BDTLL.PageStatus.SAFE]: undefined,
    [BDTLL.PageStatus.WHITELISTED]: undefined,
    [BDTLL.PageStatus.SESSION_WHITELISTED]: undefined,
    [BDTLL.PageStatus.DISABLED]: undefined,
    [BDTLL.PageStatus.SEARCH_ANALYZER_DISABLED]: undefined
};

export class ThreatBlocked extends React.Component<IThreatBlockedProps, IThreatBlockedState> {
    constructor(props: IThreatBlockedProps) {
        super(props);

        const blockedInfo: IThreatBlockedState = BlockedDetails[props.status] || BlockedDetails[BDTLL.PageStatus.UNTRUSTED];
        blockedInfo.showToast = "";

        this.state = blockedInfo;

        this.whitelistURL = this.whitelistURL.bind(this);
        this.proceedAnyway = this.proceedAnyway.bind(this);
        this.goToSafety = this.goToSafety.bind(this);
    }

    proceedAnyway(): void {
        BDTLL.MessageService.messageBackground({
            command: BDTLL.Command.SESSION_WHITELIST
        });
    }

    goToSafety(): void {
        window.location.href = "about:blank";
    }

    whitelistURL(): void {
        BDTLL.MessageService.messageBackground({
            command: BDTLL.Command.WHITELIST_ADD,
            value: this.props.url
        }).then(() => {
            this.setState({
                showToast: "in"
            });
            setTimeout(() => {
                window.location.href = this.props.url;
            }, 2000);
        });
    }

    render(): React.JSX.Element {
        const titleTextArray: string[] = BDTLL.Utils.getLocalizedText("web_protection_title").split("[CompanyName]");
        const firstPartOfText: string = titleTextArray[0];
        const secondPartOfText: string = titleTextArray[1];

        return (
            <div className="threat-blocked-container" id="threatBlockedContainer">
                <div className="threat-blocked">
                    <div className="header">
                        <div className="logo">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 60">
                                <path fill="#d0021b" d="M31.69,32.44H26V42.2h5.46c3,0,7.28-.52,7.28-5C38.74,33.68,36.48,32.44,31.69,32.44Z"/>
                                <path fill="#d0021b" d="M53.91,0H6.09A6.09,6.09,0,0,0,0,6.08V53.92A6.09,6.09,0,0,0,6.09,60H53.91A6.09,6.09,0,0,0,60,53.92V6.08A6.09,6.09,0,0,0,53.91,0ZM32.09,47.46l-10.86,0V18.79c0-1.55-1.45-1.75-3.51-3.46L16,13.87v-.54H33.08c5,0,10.19,2.36,10.19,8.58,0,3.86-2.3,6.4-5.75,7.46v.1a8.07,8.07,0,0,1,7.22,8.25C44.74,45.16,38.41,47.46,32.09,47.46Z"/>
                                <path fill="#d0021b" d="M36.22,25.76a3.79,3.79,0,0,0,1.15-2.82A3.9,3.9,0,0,0,36.26,20c-1-1-2-1.43-5.35-1.43H26v8.59h5.42C33.89,27.18,35.24,26.71,36.22,25.76Z"/>
                            </svg>
                        </div>

                        <h1>
                            {firstPartOfText != "" ? <span style={{margin: '0px 0px 2px 0px'}}>{firstPartOfText}</span> : null}
                            {BDTLL.Consts.COMPANY_NAME}
                            {secondPartOfText != "" ? <span style={{margin: '2px 0px 0px 0px'}}>{secondPartOfText}</span> : null}
                        </h1>

                    </div>

                    <div className="body">
                        <h2>{this.state.title}</h2>
                        <span className="muted">{this.props.url}</span>
                        <p style={{ whiteSpace: "pre-line" }}>{this.state.text}</p>
                    </div>

                    <div className="footer">
                        <button className="primary-btn" id="BDTLL_go_to_home" onClick={this.goToSafety} disabled={this.state.showToast == "in"}>
                            {BDTLL.Utils.getLocalizedText("alert_take_to_safety")}
                        </button>
                        <a href="#" className="link-btn" onClick={() => {this.state.showToast != "in"? this.proceedAnyway() : null}}>{BDTLL.Utils.getLocalizedText("alert_ignore")}</a>

                        <span className="small muted" id="text_whitelist">
                            {BDTLL.Utils.getLocalizedText("text_whitelist").split("{link}")[0]}
                            <a href="#" onClick={() => {this.state.showToast != "in" ? this.whitelistURL() : null}}>{BDTLL.Utils.getLocalizedText("text_whitelist").split("{link}")[1]}</a>
                            {BDTLL.Utils.getLocalizedText("text_whitelist").split("{link}")[2]}
                            <br />
                            {BDTLL.Utils.getLocalizedText("text_whitelist_cont")}
                        </span>
                    </div>
                </div>

                <div className={"toast " + this.state.showToast + " center"}>
                    <div className="toast-msg" id="text_whitelist_toast"><i className="checked"></i>{BDTLL.Utils.getLocalizedText("text_whitelist_toast")}</div>
                </div>

            </div>
        )
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const windowTitle: React.ReactElement<React.ReactFragment, string> = <>{BDTLL.Utils.getLocalizedText("web_protection_title")}</>;

    ReactDOM.render(
        windowTitle,
        document.getElementById("window_title")
    );

    const params: URLSearchParams = new URLSearchParams(window.location.search);
    const status: BDTLL.PageStatus = params.get('status') as BDTLL.PageStatus;
    const url: string = decodeURIComponent(params.get('url') || '');

    ReactDOM.render(
        <ErrorBoundary>
            <ThreatBlocked status={status} url={url}/>
        </ErrorBoundary>,
        document.getElementById('threatBlockedView')
    );
})
