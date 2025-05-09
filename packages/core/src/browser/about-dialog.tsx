// *****************************************************************************
// Copyright (C) 2018 Ericsson and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as React from 'react';
import { inject, injectable, postConstruct } from 'inversify';
import { Dialog, DialogProps } from './dialogs';
import { ReactDialog } from './dialogs/react-dialog';
import { ApplicationServer, ApplicationInfo, ExtensionInfo } from '../common/application-protocol';
import { Message } from './widgets/widget';
import { FrontendApplicationConfigProvider } from './frontend-application-config-provider';
// import { DEFAULT_SUPPORTED_API_VERSION } from '@theia/application-package/lib/api';
import { WindowService } from './window/window-service';
import { Key, KeyCode } from './keys';
import { nls } from '../common/nls';

export const ABOUT_CONTENT_CLASS = 'theia-aboutDialog';
export const ABOUT_EXTENSIONS_CLASS = 'theia-aboutExtensions';

@injectable()
export class AboutDialogProps extends DialogProps {
}

@injectable()
export class AboutDialog extends ReactDialog<void> {
    protected applicationInfo: ApplicationInfo | undefined;
    protected extensionsInfos: ExtensionInfo[] = [];
    protected readonly okButton: HTMLButtonElement;

    @inject(ApplicationServer)
    protected readonly appServer: ApplicationServer;

    @inject(WindowService)
    protected readonly windowService: WindowService;

    constructor(
        @inject(AboutDialogProps) protected override readonly props: AboutDialogProps
    ) {
        super({
            title: FrontendApplicationConfigProvider.get().applicationName,
        });
        this.appendAcceptButton(Dialog.OK);
    }

    @postConstruct()
    protected init(): void {
        this.doInit();
    }

    protected async doInit(): Promise<void> {
        this.applicationInfo = await this.appServer.getApplicationInfo();
        this.extensionsInfos = await this.appServer.getExtensionsInfos();
        this.update();
    }

    protected renderHeader(): React.ReactNode {
        // const applicationInfo = this.applicationInfo;
        // const compatibilityUrl = 'https://eclipse-theia.github.io/vscode-theia-comparator/status.html';

        const detailsLabel = nls.localizeByDefault('Details');
        // const versionLabel = nls.localizeByDefault('Version');
        // const defaultApiLabel = nls.localize('theia/core/about/defaultApi', 'Default {0} API', 'VS Code');
        // const compatibilityLabel = nls.localize('theia/core/about/compatibility', '{0} Compatibility', 'VS Code');

        return <>
            <h3>{detailsLabel}</h3>
            <div className='about-details' >
                {/* {applicationInfo && <p>{`${versionLabel}: ${applicationInfo.version}`}</p>}
                <p>{`${defaultApiLabel}: ${DEFAULT_SUPPORTED_API_VERSION}`}</p>
                <p>
                    <a
                        role={'button'}
                        tabIndex={0}
                        onClick={() => this.doOpenExternalLink(compatibilityUrl)}
                        onKeyDown={(e: React.KeyboardEvent) => this.doOpenExternalLinkEnter(e, compatibilityUrl)}>
                        {compatibilityLabel}
                    </a>
                </p> */}
                <p>MicroGPT Web IDE is a lightweight, browser-based integrated development environment specifically designed for coding and development.</p>
                <p>It combines the functionality of a traditional code editor with the capabilities powered by MicroGPT, the technology that can run directly in the browser.</p>
                <h3>Key Features</h3>
                <p>1. Modern Browser-Based Interface: Clean, dark-themed IDE with syntax highlighting that runs entirely in your browser without the need for installation.</p>
                <p>2. Left Sidebar Navigation: Project file explorer, search functionality, and extensions management all accessed through the intuitive left sidebar.</p>
                <p>3. Built-in Terminal: Integrated command-line interface for executing commands without leaving the IDE.</p>
                <p>4. Language Support: Comprehensive support for multiple programming languages including JavaScript, Python, TypeScript and more.</p>
                <p>5. Lightweight Performance: Optimized to run efficiently in modern browsers with minimal resource usage, making it suitable for less powerful machines.</p>
                <p>6. Version Control Integration: Built-in Git support for managing code versions directly from the interface.</p>
            </div>
        </>;
    }

    protected renderExtensions(): React.ReactNode {
        // const extensionsInfos = this.extensionsInfos;
        // const listOfExtensions = nls.localize('theia/core/about/listOfExtensions', 'List of extensions');
        return <>
            {/* <h3>{listOfExtensions}</h3>
            <ul className={ABOUT_EXTENSIONS_CLASS}>
                {
                    extensionsInfos
                        .sort((a: ExtensionInfo, b: ExtensionInfo) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
                        .map((extension: ExtensionInfo) => <li key={extension.name}>{extension.name} {extension.version}</li>)
                }
            </ul> */}
        </>;
    }

    protected render(): React.ReactNode {
        return <div className={ABOUT_CONTENT_CLASS}>
            {this.renderHeader()}
            {this.renderExtensions()}
        </div>;
    }

    protected override onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        this.update();
    }

    /**
     * Open a link in an external window.
     * @param url the link.
     */
    protected doOpenExternalLink = (url: string) => this.windowService.openNewWindow(url, { external: true });
    protected doOpenExternalLinkEnter = (e: React.KeyboardEvent, url: string) => {
        if (this.isEnterKey(e)) {
            this.doOpenExternalLink(url);
        }
    };

    protected isEnterKey(e: React.KeyboardEvent): boolean {
        return Key.ENTER.keyCode === KeyCode.createKeyCode(e.nativeEvent).key?.keyCode;
    }

    get value(): undefined { return undefined; }
}
