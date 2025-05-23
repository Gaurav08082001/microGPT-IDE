// *****************************************************************************
// Copyright (C) 2018 Red Hat, Inc. and others.
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

import { injectable, inject, postConstruct, optional } from '@theia/core/shared/inversify';
import {
    ApplicationShell, ViewContainer as ViewContainerWidget, WidgetManager, QuickViewService,
    ViewContainerIdentifier, ViewContainerTitleOptions, Widget, FrontendApplicationContribution,
    StatefulWidget, CommonMenus, TreeViewWelcomeWidget, ViewContainerPart, BaseWidget,
} from '@theia/core/lib/browser';
import { ViewContainer, View, ViewWelcome, PluginViewType } from '../../../common';
import { PluginSharedStyle } from '../plugin-shared-style';
import { DebugWidget } from '@theia/debug/lib/browser/view/debug-widget';
import { PluginViewWidget, PluginViewWidgetIdentifier } from './plugin-view-widget';
import { SCM_VIEW_CONTAINER_ID, ScmContribution } from '@theia/scm/lib/browser/scm-contribution';
import { EXPLORER_VIEW_CONTAINER_ID, FileNavigatorWidget, FILE_NAVIGATOR_ID } from '@theia/navigator/lib/browser';
import { FileNavigatorContribution } from '@theia/navigator/lib/browser/navigator-contribution';
import { DebugFrontendApplicationContribution } from '@theia/debug/lib/browser/debug-frontend-application-contribution';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { MenuModelRegistry } from '@theia/core/lib/common/menu';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { ContextKey, ContextKeyService } from '@theia/core/lib/browser/context-key-service';
import { ViewContextKeyService } from './view-context-key-service';
import { PROBLEMS_WIDGET_ID } from '@theia/markers/lib/browser/problem/problem-widget';
import { OutputWidget } from '@theia/output/lib/browser/output-widget';
import { DebugConsoleContribution } from '@theia/debug/lib/browser/console/debug-console-contribution';
import { TreeViewWidget } from './tree-view-widget';
import { SEARCH_VIEW_CONTAINER_ID } from '@theia/search-in-workspace/lib/browser/search-in-workspace-factory';
import { TEST_VIEW_CONTAINER_ID } from '@theia/test/lib/browser/view/test-view-contribution';
import { WebviewView, WebviewViewResolver } from '../webview-views/webview-views';
import { WebviewWidget, WebviewWidgetIdentifier } from '../webview/webview';
import { CancellationToken } from '@theia/core/lib/common/cancellation';
import { generateUuid } from '@theia/core/lib/common/uuid';
import { nls } from '@theia/core';
import { TheiaDockPanel } from '@theia/core/lib/browser/shell/theia-dock-panel';
import { Deferred } from '@theia/core/lib/common/promise-util';
import { ThemeIcon } from '@theia/monaco-editor-core/esm/vs/base/common/themables';

export const PLUGIN_VIEW_FACTORY_ID = 'plugin-view';
export const PLUGIN_VIEW_CONTAINER_FACTORY_ID = 'plugin-view-container';
export const PLUGIN_VIEW_DATA_FACTORY_ID = 'plugin-view-data';

export type ViewDataProvider = (params: { state?: object, viewInfo: View }) => Promise<TreeViewWidget>;

export interface ViewContainerInfo {
    id: string
    location: string
    options: ViewContainerTitleOptions
    onViewAdded: () => void
}

@injectable()
export class PluginViewRegistry implements FrontendApplicationContribution {

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(PluginSharedStyle)
    protected readonly style: PluginSharedStyle;

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    @inject(ScmContribution)
    protected readonly scm: ScmContribution;

    @inject(FileNavigatorContribution)
    protected readonly explorer: FileNavigatorContribution;

    @inject(DebugFrontendApplicationContribution)
    protected readonly debug: DebugFrontendApplicationContribution;

    @inject(CommandRegistry)
    protected readonly commands: CommandRegistry;

    @inject(MenuModelRegistry)
    protected readonly menus: MenuModelRegistry;

    @inject(QuickViewService) @optional()
    protected readonly quickView: QuickViewService;

    @inject(ContextKeyService)
    protected readonly contextKeyService: ContextKeyService;

    @inject(ViewContextKeyService)
    protected readonly viewContextKeys: ViewContextKeyService;

    protected readonly onDidExpandViewEmitter = new Emitter<string>();
    readonly onDidExpandView = this.onDidExpandViewEmitter.event;

    private readonly views = new Map<string, [string, View]>();
    private readonly viewsWelcome = new Map<string, ViewWelcome[]>();
    private readonly viewContainers = new Map<string, ViewContainerInfo>();
    private readonly containerViews = new Map<string, string[]>();
    private readonly viewClauseContexts = new Map<string, Set<string> | undefined>();

    private readonly viewDataProviders = new Map<string, ViewDataProvider>();
    private readonly viewDataState = new Map<string, object>();

    private readonly webviewViewResolvers = new Map<string, WebviewViewResolver>();
    protected readonly onNewResolverRegisteredEmitter = new Emitter<{ readonly viewType: string }>();
    readonly onNewResolverRegistered = this.onNewResolverRegisteredEmitter.event;

    private readonly webviewViewRevivals = new Map<string, { readonly webview: WebviewView; readonly revival: Deferred<void> }>();

    private nextViewContainerId = 0;

    // private static readonly BUILTIN_VIEW_CONTAINERS = new Set<string>([
    //     'explorer',
    //     'scm',
    //     'search',
    //     'test',
    //     'debug'
    // ]);

    private static readonly ID_MAPPINGS: Map<string, string> = new Map([
        // VS Code Viewlets
        [EXPLORER_VIEW_CONTAINER_ID, 'workbench.view.explorer'],
        [SCM_VIEW_CONTAINER_ID, 'workbench.view.scm'],
        [SEARCH_VIEW_CONTAINER_ID, 'workbench.view.search'],
        [DebugWidget.ID, 'workbench.view.debug'],
        ['vsx-extensions-view-container', 'workbench.view.extensions'], // cannot use the id from 'vsx-registry' package because of circular dependency
        [PROBLEMS_WIDGET_ID, 'workbench.panel.markers'],
        [TEST_VIEW_CONTAINER_ID, 'workbench.view.testing'],
        [OutputWidget.ID, 'workbench.panel.output'],
        [DebugConsoleContribution.options.id, 'workbench.panel.repl'],
        // Theia does not have a single terminal widget, but instead each terminal gets its own widget. Therefore "the terminal widget is active" doesn't make sense in Theia
        // [TERMINAL_WIDGET_FACTORY_ID, 'workbench.panel.terminal'],
        // [?? , 'workbench.panel.comments'] not sure what this mean: we don't show comments in sidebars nor the bottom
    ]);

    @postConstruct()
    protected init(): void {

        // TODO workbench.panel.comments - Theia does not have a proper comments view yet

        this.updateFocusedView();
        this.shell.onDidChangeActiveWidget(() => this.updateFocusedView());

        this.widgetManager.onWillCreateWidget(({ factoryId, widget, waitUntil }) => {
            if (factoryId === EXPLORER_VIEW_CONTAINER_ID && widget instanceof ViewContainerWidget) {
                waitUntil(this.prepareViewContainer('explorer', widget));
            }
            if (factoryId === SCM_VIEW_CONTAINER_ID && widget instanceof ViewContainerWidget) {
                waitUntil(this.prepareViewContainer('scm', widget));
            }
            if (factoryId === SEARCH_VIEW_CONTAINER_ID && widget instanceof ViewContainerWidget) {
                waitUntil(this.prepareViewContainer('search', widget));
            }
            if (factoryId === TEST_VIEW_CONTAINER_ID && widget instanceof ViewContainerWidget) {
                waitUntil(this.prepareViewContainer('test', widget));
            }
            if (factoryId === DebugWidget.ID && widget instanceof DebugWidget) {
                const viewContainer = widget['sessionWidget']['viewContainer'];
                waitUntil(this.prepareViewContainer('debug', viewContainer));
            }
            if (factoryId === PLUGIN_VIEW_CONTAINER_FACTORY_ID && widget instanceof ViewContainerWidget) {
                waitUntil(this.prepareViewContainer(this.toViewContainerId(widget.options), widget));
            }
            if (factoryId === PLUGIN_VIEW_FACTORY_ID && widget instanceof PluginViewWidget) {
                waitUntil(this.prepareView(widget));
            }
        });
        this.widgetManager.onDidCreateWidget(event => {
            if (event.widget instanceof FileNavigatorWidget) {
                const disposable = new DisposableCollection();
                disposable.push(this.registerViewWelcome({
                    view: 'explorer',
                    content: nls.localizeByDefault(
                        'You have not yet opened a folder.\n{0}',
                        `[${nls.localizeByDefault('Open Folder')}](command:workbench.action.files.openFolder)`
                    ),
                    order: 0
                }));
                disposable.push(event.widget.onDidDispose(() => disposable.dispose()));
            }
        });
        this.contextKeyService.onDidChange(e => {
            for (const [, view] of this.views.values()) {
                const clauseContext = this.viewClauseContexts.get(view.id);
                if (clauseContext && e.affects(clauseContext)) {
                    this.updateViewVisibility(view.id);
                }
            }
            for (const [viewId, viewWelcomes] of this.viewsWelcome) {
                for (const [index] of viewWelcomes.entries()) {
                    const viewWelcomeId = this.toViewWelcomeId(index, viewId);
                    const clauseContext = this.viewClauseContexts.get(viewWelcomeId);
                    if (clauseContext && e.affects(clauseContext)) {
                        this.updateViewWelcomeVisibility(viewId);
                    }
                }
            }
        });

        const hookDockPanelKey = (panel: TheiaDockPanel, key: ContextKey<string>) => {
            let toDisposeOnActivate = new DisposableCollection();
            panel.onDidChangeCurrent(title => {
                toDisposeOnActivate.dispose();
                toDisposeOnActivate = new DisposableCollection();
                if (title && title.owner instanceof BaseWidget) {
                    const widget = title.owner;
                    let value = PluginViewRegistry.ID_MAPPINGS.get(widget.id);
                    if (!value) {
                        if (widget.id.startsWith(PLUGIN_VIEW_CONTAINER_FACTORY_ID)) {
                            value = this.toViewContainerId({ id: widget.id });
                        }
                    }
                    const setKey = () => {
                        if (widget.isVisible && value) {
                            key.set(value);
                        } else {
                            key.reset();
                        }
                    };
                    toDisposeOnActivate.push(widget.onDidChangeVisibility(() => {
                        setKey();
                    }));
                    setKey();

                }
            });
        };

        this.shell.initialized.then(() => {
            hookDockPanelKey(this.shell.leftPanelHandler.dockPanel, this.viewContextKeys.activeViewlet);
            hookDockPanelKey(this.shell.rightPanelHandler.dockPanel, this.viewContextKeys.activeAuxiliary);
            hookDockPanelKey(this.shell.bottomPanel, this.viewContextKeys.activePanel);
        });
    }

    protected async updateViewWelcomeVisibility(viewId: string): Promise<void> {
        const widget = await this.getTreeViewWelcomeWidget(viewId);
        if (widget) {
            widget.handleWelcomeContextChange();
        }
    }

    protected async updateViewVisibility(viewId: string): Promise<void> {
        const widget = await this.getView(viewId);
        if (!widget) {
            if (this.isViewVisible(viewId)) {
                await this.openView(viewId);
            }
            return;
        }
        const viewInfo = this.views.get(viewId);
        if (!viewInfo) {
            return;
        }
        const [viewContainerId] = viewInfo;
        const viewContainer = await this.getPluginViewContainer(viewContainerId);
        if (!viewContainer) {
            return;
        }
        const part = viewContainer.getPartFor(widget);
        if (!part) {
            return;
        }
        widget.updateViewVisibility(() =>
            part.setHidden(!this.isViewVisible(viewId))
        );
    }

    protected isViewVisible(viewId: string): boolean {
        const viewInfo = this.views.get(viewId);
        if (!viewInfo) {
            return false;
        }
        const [, view] = viewInfo;
        return view.when === undefined || view.when === 'true' || this.contextKeyService.match(view.when);
    }

    registerViewContainer(location: string, viewContainer: ViewContainer): Disposable {
        const containerId = `workbench.view.extension.${viewContainer.id}`;
        if (this.viewContainers.has(containerId)) {
            console.warn('view container such id already registered: ', JSON.stringify(viewContainer));
            return Disposable.NULL;
        }
        const toDispose = new DisposableCollection();
        const containerClass = 'theia-plugin-view-container';
        let themeIconClass = '';
        const iconClass = 'plugin-view-container-icon-' + this.nextViewContainerId++; // having dots in class would not work for css, so we need to generate an id.

        if (viewContainer.themeIcon) {
            const icon = ThemeIcon.fromString(viewContainer.themeIcon);
            if (icon) {
                themeIconClass = ThemeIcon.asClassName(icon) ?? '';
            }
        }

        if (!themeIconClass) {
            const iconUrl = PluginSharedStyle.toExternalIconUrl(viewContainer.iconUrl);
            toDispose.push(this.style.insertRule('.' + containerClass + '.' + iconClass, () => `
                mask: url('${iconUrl}') no-repeat 50% 50%;
                -webkit-mask: url('${iconUrl}') no-repeat 50% 50%;
            `));
        }

        toDispose.push(this.doRegisterViewContainer(containerId, location, {
            label: viewContainer.title,
            // The container class automatically sets a mask; if we're using a theme icon, we don't want one.
            iconClass: (themeIconClass || containerClass) + ' ' + iconClass,
            closeable: true
        }));
        return toDispose;
    }

    protected async toggleViewContainer(id: string): Promise<void> {
        let widget = await this.getPluginViewContainer(id);
        if (widget && widget.isAttached) {
            widget.dispose();
        } else {
            widget = await this.openViewContainer(id);
            if (widget) {
                this.shell.activateWidget(widget.id);
            }
        }
    }

    protected doRegisterViewContainer(id: string, location: string, options: ViewContainerTitleOptions): Disposable {
        const toDispose = new DisposableCollection();
        toDispose.push(Disposable.create(() => this.viewContainers.delete(id)));
        const toggleCommandId = `plugin.view-container.${id}.toggle`;
        // Some plugins may register empty view containers.
        // We should not register commands for them immediately, as that leads to bad UX.
        // Instead, we register commands the first time we add a view to them.
        let activate = () => {
            toDispose.push(this.commands.registerCommand({
                id: toggleCommandId,
                category: nls.localizeByDefault('View'),
                label: nls.localizeByDefault('Toggle {0}', options.label)
            }, {
                execute: () => this.toggleViewContainer(id)
            }));
            toDispose.push(this.menus.registerMenuAction(CommonMenus.VIEW_VIEWS, {
                commandId: toggleCommandId,
                label: options.label
            }));
            toDispose.push(this.quickView?.registerItem({
                label: options.label,
                open: async () => {
                    const widget = await this.openViewContainer(id);
                    if (widget) {
                        this.shell.activateWidget(widget.id);
                    }
                }
            }));
            toDispose.push(Disposable.create(async () => {
                const widget = await this.getPluginViewContainer(id);
                if (widget) {
                    widget.dispose();
                }
            }));
            // Ignore every subsequent activation call
            activate = () => { };
        };
        this.viewContainers.set(id, {
            id,
            location,
            options,
            onViewAdded: () => activate()
        });
        return toDispose;
    }

    getContainerViews(viewContainerId: string): string[] {
        return this.containerViews.get(viewContainerId) || [];
    }

    registerView(viewContainerId: string, view: View): Disposable {
        // if (!PluginViewRegistry.BUILTIN_VIEW_CONTAINERS.has(viewContainerId)) {
        //     // if it's not a built-in view container, it must be a contributed view container, see https://github.com/eclipse-theia/theia/issues/13249
        //     viewContainerId = `workbench.view.extension.${viewContainerId}`;
        // }
        if (this.views.has(view.id)) {
            console.warn('view with such id already registered: ', JSON.stringify(view));
            return Disposable.NULL;
        }
        const toDispose = new DisposableCollection();

        view.when = view.when?.trim();
        this.views.set(view.id, [viewContainerId, view]);
        toDispose.push(Disposable.create(() => this.views.delete(view.id)));

        const containerInfo = this.viewContainers.get(viewContainerId);
        if (containerInfo) {
            containerInfo.onViewAdded();
        }

        const containerViews = this.getContainerViews(viewContainerId);
        containerViews.push(view.id);
        this.containerViews.set(viewContainerId, containerViews);
        toDispose.push(Disposable.create(() => {
            const index = containerViews.indexOf(view.id);
            if (index !== -1) {
                containerViews.splice(index, 1);
            }
        }));

        if (view.when && view.when !== 'false' && view.when !== 'true') {
            const keys = this.contextKeyService.parseKeys(view.when);
            if (keys) {
                this.viewClauseContexts.set(view.id, keys);
                toDispose.push(Disposable.create(() => this.viewClauseContexts.delete(view.id)));
            }
        }
        toDispose.push(this.quickView?.registerItem({
            label: view.name,
            when: view.when,
            open: () => this.openView(view.id, { activate: true })
        }));
        toDispose.push(this.commands.registerCommand({ id: `${view.id}.focus` }, {
            execute: async () => { await this.openView(view.id, { activate: true }); }
        }));
        return toDispose;
    }

    async resolveWebviewView(viewId: string, webview: WebviewView, cancellation: CancellationToken): Promise<void> {
        const resolver = this.webviewViewResolvers.get(viewId);
        if (resolver) {
            return resolver.resolve(webview, cancellation);
        }
        const pendingRevival = this.webviewViewRevivals.get(viewId);
        if (pendingRevival) {
            return pendingRevival.revival.promise;
        }
        const pending = new Deferred<void>();
        this.webviewViewRevivals.set(viewId, { webview, revival: pending });
        return pending.promise;
    }

    async registerWebviewView(viewId: string, resolver: WebviewViewResolver): Promise<Disposable> {
        if (this.webviewViewResolvers.has(viewId)) {
            throw new Error(`View resolver already registered for ${viewId}`);
        }
        this.webviewViewResolvers.set(viewId, resolver);
        this.onNewResolverRegisteredEmitter.fire({ viewType: viewId });

        const toDispose = new DisposableCollection(Disposable.create(() => this.webviewViewResolvers.delete(viewId)));
        this.initView(viewId, toDispose);

        const pendingRevival = this.webviewViewRevivals.get(viewId);
        if (pendingRevival) {
            resolver.resolve(pendingRevival.webview, CancellationToken.None).then(() => {
                this.webviewViewRevivals.delete(viewId);
                pendingRevival.revival.resolve();
            });
        }

        return toDispose;
    }

    protected async createNewWebviewView(viewId: string): Promise<WebviewView> {
        const webview = await this.widgetManager.getOrCreateWidget<WebviewWidget>(
            WebviewWidget.FACTORY_ID, <WebviewWidgetIdentifier>{
                id: generateUuid(),
                viewId,
            });
        webview.setContentOptions({ allowScripts: true });

        let _description: string | undefined;
        let _resolved = false;
        let _pendingResolution: Promise<void> | undefined;

        const webviewView: WebviewView = {
            webview,

            get onDidChangeVisibility(): Event<boolean> { return webview.onDidChangeVisibility; },
            get onDidDispose(): Event<void> { return webview.onDidDispose; },

            get title(): string | undefined { return webview.title.label; },
            set title(value: string | undefined) { webview.title.label = value || ''; },

            get description(): string | undefined { return _description; },
            set description(value: string | undefined) { _description = value; },

            get badge(): number | undefined { return webview.badge; },
            set badge(badge: number | undefined) { webview.badge = badge; },

            get badgeTooltip(): string | undefined { return webview.badgeTooltip; },
            set badgeTooltip(badgeTooltip: string | undefined) { webview.badgeTooltip = badgeTooltip; },
            onDidChangeBadge: webview.onDidChangeBadge,
            onDidChangeBadgeTooltip: webview.onDidChangeBadgeTooltip,

            dispose: () => {
                _resolved = false;
                webview.dispose();
                toDispose.dispose();
            },
            resolve: async () => {
                if (_resolved) {
                    return;
                }
                if (_pendingResolution) {
                    return _pendingResolution;
                }
                _pendingResolution = this.resolveWebviewView(viewId, webviewView, CancellationToken.None).then(() => {
                    _resolved = true;
                    _pendingResolution = undefined;
                });
                return _pendingResolution;
            },
            show: webview.show
        };

        const toDispose = this.onNewResolverRegistered(resolver => {
            if (resolver.viewType === viewId) {
                // Potentially re-activate if we have a new resolver
                webviewView.resolve();
            }
        });

        webviewView.resolve();
        return webviewView;
    }

    registerViewWelcome(viewWelcome: ViewWelcome): Disposable {
        const toDispose = new DisposableCollection();

        const viewsWelcome = this.viewsWelcome.get(viewWelcome.view) || [];
        if (viewsWelcome.some(e => e.content === viewWelcome.content)) {
            return toDispose;
        }
        viewsWelcome.push(viewWelcome);
        this.viewsWelcome.set(viewWelcome.view, viewsWelcome);
        this.handleViewWelcomeChange(viewWelcome.view);
        toDispose.push(Disposable.create(() => {
            const index = viewsWelcome.indexOf(viewWelcome);
            if (index !== -1) {
                viewsWelcome.splice(index, 1);
            }
            this.handleViewWelcomeChange(viewWelcome.view);
        }));

        if (viewWelcome.when) {
            const index = viewsWelcome.indexOf(viewWelcome);
            const viewWelcomeId = this.toViewWelcomeId(index, viewWelcome.view);
            this.viewClauseContexts.set(viewWelcomeId, this.contextKeyService.parseKeys(viewWelcome.when));
            toDispose.push(Disposable.create(() => this.viewClauseContexts.delete(viewWelcomeId)));
        }
        return toDispose;
    }

    async handleViewWelcomeChange(viewId: string): Promise<void> {
        const widget = await this.getTreeViewWelcomeWidget(viewId);
        if (widget) {
            widget.handleViewWelcomeContentChange(this.getViewWelcomes(viewId));
        }
    }

    protected async getTreeViewWelcomeWidget(viewId: string): Promise<TreeViewWelcomeWidget | undefined> {
        switch (viewId) {
            case 'explorer':
                return this.widgetManager.getWidget<TreeViewWelcomeWidget>(FILE_NAVIGATOR_ID);
            default:
                return this.widgetManager.getWidget<TreeViewWelcomeWidget>(PLUGIN_VIEW_DATA_FACTORY_ID, { id: viewId });
        }
    }

    getViewWelcomes(viewId: string): ViewWelcome[] {
        return this.viewsWelcome.get(viewId) || [];
    }

    async getView(viewId: string): Promise<PluginViewWidget | undefined> {
        if (!this.views.has(viewId)) {
            return undefined;
        }
        return this.widgetManager.getWidget<PluginViewWidget>(PLUGIN_VIEW_FACTORY_ID, this.toPluginViewWidgetIdentifier(viewId));
    }

    async openView(viewId: string, options?: { activate?: boolean, reveal?: boolean }): Promise<PluginViewWidget | undefined> {
        const view = await this.doOpenView(viewId);
        if (view && options) {
            if (options.activate === true) {
                await this.shell.activateWidget(view.id);
            } else if (options.reveal === true) {
                await this.shell.revealWidget(view.id);
            }
        }
        return view;
    }
    protected async doOpenView(viewId: string): Promise<PluginViewWidget | undefined> {
        const widget = await this.getView(viewId);
        if (widget) {
            return widget;
        }
        const data = this.views.get(viewId);
        if (!data) {
            return undefined;
        }
        const [containerId] = data;
        await this.openViewContainer(containerId);
        return this.getView(viewId);
    }

    protected async prepareView(widget: PluginViewWidget): Promise<void> {
        const data = this.views.get(widget.options.viewId);
        if (!data) {
            return;
        }
        const [, view] = data;
        if (!widget.title.label) {
            widget.title.label = view.name;
        }
        const currentDataWidget = widget.widgets[0];
        const webviewId = currentDataWidget instanceof WebviewWidget ? currentDataWidget.identifier?.id : undefined;
        const viewDataWidget = await this.createViewDataWidget(view.id, webviewId);
        if (widget.isDisposed) {
            viewDataWidget?.dispose();
            return;
        }
        if (currentDataWidget !== viewDataWidget) {
            if (currentDataWidget) {
                currentDataWidget.dispose();
            }
            if (viewDataWidget) {
                widget.addWidget(viewDataWidget);
            }
        }
    }

    protected getOrCreateViewContainerWidget(containerId: string): Promise<ViewContainerWidget> {
        const identifier = this.toViewContainerIdentifier(containerId);
        return this.widgetManager.getOrCreateWidget<ViewContainerWidget>(PLUGIN_VIEW_CONTAINER_FACTORY_ID, identifier);
    }

    async openViewContainer(containerId: string): Promise<ViewContainerWidget | undefined> {
        if (containerId === 'explorer') {
            const widget = await this.explorer.openView();
            if (widget.parent instanceof ViewContainerWidget) {
                return widget.parent;
            }
            return undefined;
        }
        if (containerId === 'scm') {
            const widget = await this.scm.openView();
            if (widget.parent instanceof ViewContainerWidget) {
                return widget.parent;
            }
            return undefined;
        }
        if (containerId === 'debug') {
            const widget = await this.debug.openView();
            return widget['sessionWidget']['viewContainer'];
        }
        const data = this.viewContainers.get(containerId);
        if (!data) {
            return undefined;
        }
        const { location } = data;
        const containerWidget = await this.getOrCreateViewContainerWidget(containerId);
        if (!containerWidget.isAttached) {
            await this.shell.addWidget(containerWidget, {
                area: ApplicationShell.isSideArea(location) ? location : 'left',
                rank: Number.MAX_SAFE_INTEGER
            });
        }
        return containerWidget;
    }

    protected async prepareViewContainer(viewContainerId: string, containerWidget: ViewContainerWidget): Promise<void> {
        const data = this.viewContainers.get(viewContainerId);
        if (data) {
            const { options } = data;
            containerWidget.setTitleOptions(options);
        }
        for (const viewId of this.getContainerViews(viewContainerId)) {
            const identifier = this.toPluginViewWidgetIdentifier(viewId);
            // Keep existing widget in its current container and reregister its part to the plugin view widget events.
            const existingWidget = this.widgetManager.tryGetWidget<PluginViewWidget>(PLUGIN_VIEW_FACTORY_ID, identifier);
            if (existingWidget && existingWidget.currentViewContainerId) {
                const currentContainer = await this.getPluginViewContainer(existingWidget.currentViewContainerId);
                if (currentContainer && this.registerWidgetPartEvents(existingWidget, currentContainer)) {
                    continue;
                }
            }
            const widget = await this.widgetManager.getOrCreateWidget<PluginViewWidget>(PLUGIN_VIEW_FACTORY_ID, identifier);
            if (containerWidget.getTrackableWidgets().indexOf(widget) === -1) {
                containerWidget.addWidget(widget, {
                    initiallyCollapsed: !!containerWidget.getParts().length,
                    initiallyHidden: !this.isViewVisible(viewId)
                });
            }
            this.registerWidgetPartEvents(widget, containerWidget);
        }
    }

    protected registerWidgetPartEvents(widget: PluginViewWidget, containerWidget: ViewContainerWidget): ViewContainerPart | undefined {
        const part = containerWidget.getPartFor(widget);
        if (part) {

            widget.currentViewContainerId = this.getViewContainerId(containerWidget);
            part.onDidMove(event => { widget.currentViewContainerId = this.getViewContainerId(event); });

            // if a view is explicitly hidden then suppress updating visibility based on `when` closure
            part.onDidChangeVisibility(() => widget.suppressUpdateViewVisibility = part.isHidden);

            const tryFireOnDidExpandView = () => {
                if (widget.widgets.length === 0) {
                    if (!part.collapsed && part.isVisible) {
                        const viewId = this.toViewId(widget.options);
                        this.onDidExpandViewEmitter.fire(viewId);
                    }
                } else {
                    toFire.dispose();
                }
            };
            const toFire = new DisposableCollection(
                part.onCollapsed(tryFireOnDidExpandView),
                part.onDidChangeVisibility(tryFireOnDidExpandView)
            );

            tryFireOnDidExpandView();
            return part;
        }
    };

    protected getViewContainerId(container: ViewContainerWidget): string | undefined {
        const description = this.widgetManager.getDescription(container);
        switch (description?.factoryId) {
            case EXPLORER_VIEW_CONTAINER_ID: return 'explorer';
            case SCM_VIEW_CONTAINER_ID: return 'scm';
            case SEARCH_VIEW_CONTAINER_ID: return 'search';
            case TEST_VIEW_CONTAINER_ID: return 'test';
            case undefined: return container.parent?.parent instanceof DebugWidget ? 'debug' : container.id;
            case PLUGIN_VIEW_CONTAINER_FACTORY_ID: return this.toViewContainerId(description.options);
            default: return container.id;
        }
    }

    protected async getPluginViewContainer(viewContainerId: string): Promise<ViewContainerWidget | undefined> {
        if (viewContainerId === 'explorer') {
            return this.widgetManager.getWidget<ViewContainerWidget>(EXPLORER_VIEW_CONTAINER_ID);
        }
        if (viewContainerId === 'scm') {
            return this.widgetManager.getWidget<ViewContainerWidget>(SCM_VIEW_CONTAINER_ID);
        }
        if (viewContainerId === 'search') {
            return this.widgetManager.getWidget<ViewContainerWidget>(SEARCH_VIEW_CONTAINER_ID);
        }
        if (viewContainerId === 'test') {
            return this.widgetManager.getWidget<ViewContainerWidget>(TEST_VIEW_CONTAINER_ID);
        }
        if (viewContainerId === 'debug') {
            const debug = await this.widgetManager.getWidget(DebugWidget.ID);
            if (debug instanceof DebugWidget) {
                return debug['sessionWidget']['viewContainer'];
            }
        }
        const identifier = this.toViewContainerIdentifier(viewContainerId);
        return this.widgetManager.getWidget<ViewContainerWidget>(PLUGIN_VIEW_CONTAINER_FACTORY_ID, identifier);
    }

    protected async initViewContainer(containerId: string): Promise<void> {
        let viewContainer = await this.getPluginViewContainer(containerId);
        if (!viewContainer) {
            viewContainer = await this.openViewContainer(containerId);
            if (viewContainer && !viewContainer.getParts().filter(part => !part.isHidden).length) {
                // close view containers without any visible view parts
                viewContainer.dispose();
            }
        } else {
            await this.prepareViewContainer(this.toViewContainerId(viewContainer.options), viewContainer);
        }
    }

    async initWidgets(): Promise<void> {
        const promises: Promise<void>[] = [];
        for (const id of this.viewContainers.keys()) {
            promises.push((async () => {
                await this.initViewContainer(id);
            })().catch(console.error));
        }
        promises.push((async () => {
            const explorer = await this.widgetManager.getWidget(EXPLORER_VIEW_CONTAINER_ID);
            if (explorer instanceof ViewContainerWidget) {
                await this.prepareViewContainer('explorer', explorer);
            }
        })().catch(console.error));
        promises.push((async () => {
            const scm = await this.widgetManager.getWidget(SCM_VIEW_CONTAINER_ID);
            if (scm instanceof ViewContainerWidget) {
                await this.prepareViewContainer('scm', scm);
            }
        })().catch(console.error));
        promises.push((async () => {
            const search = await this.widgetManager.getWidget(SEARCH_VIEW_CONTAINER_ID);
            if (search instanceof ViewContainerWidget) {
                await this.prepareViewContainer('search', search);
            }
        })().catch(console.error));
        promises.push((async () => {
            const test = await this.widgetManager.getWidget(TEST_VIEW_CONTAINER_ID);
            if (test instanceof ViewContainerWidget) {
                await this.prepareViewContainer('test', test);
            }
        })().catch(console.error));
        promises.push((async () => {
            const debug = await this.widgetManager.getWidget(DebugWidget.ID);
            if (debug instanceof DebugWidget) {
                const viewContainer = debug['sessionWidget']['viewContainer'];
                await this.prepareViewContainer('debug', viewContainer);
            }
        })().catch(console.error));
        await Promise.all(promises);
    }

    async removeStaleWidgets(): Promise<void> {
        const views = this.widgetManager.getWidgets(PLUGIN_VIEW_FACTORY_ID);
        for (const view of views) {
            if (view instanceof PluginViewWidget) {
                const id = this.toViewId(view.options);
                if (!this.views.has(id)) {
                    view.dispose();
                }
            }
        }
        const viewContainers = this.widgetManager.getWidgets(PLUGIN_VIEW_CONTAINER_FACTORY_ID);
        for (const viewContainer of viewContainers) {
            if (viewContainer instanceof ViewContainerWidget) {
                const id = this.toViewContainerId(viewContainer.options);
                if (!this.viewContainers.has(id)) {
                    viewContainer.dispose();
                }
            }
        }
    }

    protected toViewContainerIdentifier(viewContainerId: string): ViewContainerIdentifier {
        return { id: PLUGIN_VIEW_CONTAINER_FACTORY_ID + ':' + viewContainerId, progressLocationId: viewContainerId };
    }
    protected toViewContainerId(identifier: ViewContainerIdentifier): string {
        return identifier.id.substring(PLUGIN_VIEW_CONTAINER_FACTORY_ID.length + 1);
    }

    protected toPluginViewWidgetIdentifier(viewId: string): PluginViewWidgetIdentifier {
        return { id: PLUGIN_VIEW_FACTORY_ID + ':' + viewId, viewId };
    }
    protected toViewId(identifier: PluginViewWidgetIdentifier): string {
        return identifier.viewId;
    }

    protected toViewWelcomeId(index: number, viewId: string): string {
        return `view-welcome.${viewId}.${index}`;
    }

    /**
     * retrieve restored layout state from previous user session but close widgets
     * widgets should be opened only when view data providers are registered
     */
    onDidInitializeLayout(): void {
        const widgets = this.widgetManager.getWidgets(PLUGIN_VIEW_DATA_FACTORY_ID);
        for (const widget of widgets) {
            if (StatefulWidget.is(widget)) {
                const state = widget.storeState();
                if (state) {
                    this.viewDataState.set(widget.id, state);
                }
            }
            widget.dispose();
        }
    }

    registerViewDataProvider(viewId: string, provider: ViewDataProvider): Disposable {
        if (this.viewDataProviders.has(viewId)) {
            console.error(`data provider for '${viewId}' view is already registered`);
            return Disposable.NULL;
        }
        this.viewDataProviders.set(viewId, provider);
        const toDispose = new DisposableCollection(Disposable.create(() => {
            this.viewDataProviders.delete(viewId);
            this.viewDataState.delete(viewId);
        }));
        this.initView(viewId, toDispose);
        return toDispose;
    }

    protected async initView(viewId: string, toDispose: DisposableCollection): Promise<void> {
        const view = await this.getView(viewId);
        if (toDispose.disposed) {
            return;
        }
        if (view) {
            if (view.isVisible) {
                await this.prepareView(view);
            } else {
                const toDisposeOnDidExpandView = new DisposableCollection(this.onDidExpandView(async id => {
                    if (id === viewId) {
                        unsubscribe();
                        await this.prepareView(view);
                    }
                }));
                const unsubscribe = () => toDisposeOnDidExpandView.dispose();
                view.disposed.connect(unsubscribe);
                toDisposeOnDidExpandView.push(Disposable.create(() => view.disposed.disconnect(unsubscribe)));
                toDispose.push(toDisposeOnDidExpandView);
            }
        }
    }

    protected async createViewDataWidget(viewId: string, webviewId?: string): Promise<Widget | undefined> {
        const view = this.views.get(viewId);
        if (view?.[1]?.type === PluginViewType.Webview) {
            return this.createWebviewWidget(viewId, webviewId);
        }
        const provider = this.viewDataProviders.get(viewId);
        if (!view || !provider) {
            return undefined;
        }
        const [, viewInfo] = view;
        const state = this.viewDataState.get(viewId);
        const widget = await provider({ state, viewInfo });
        widget.handleViewWelcomeContentChange(this.getViewWelcomes(viewId));
        if (StatefulWidget.is(widget)) {
            this.storeViewDataStateOnDispose(viewId, widget);
        } else {
            this.viewDataState.delete(viewId);
        }
        return widget;
    }

    protected async createWebviewWidget(viewId: string, webviewId?: string): Promise<Widget | undefined> {
        if (!webviewId) {
            const webviewView = await this.createNewWebviewView(viewId);
            webviewId = webviewView.webview.identifier.id;
        }
        const webviewWidget = this.widgetManager.getWidget(WebviewWidget.FACTORY_ID, <WebviewWidgetIdentifier>{ id: webviewId, viewId });
        return webviewWidget;
    }

    protected storeViewDataStateOnDispose(viewId: string, widget: Widget & StatefulWidget): void {
        const dispose = widget.dispose.bind(widget);
        widget.dispose = () => {
            const state = widget.storeState();
            if (state) {
                this.viewDataState.set(viewId, state);
            }
            dispose();
        };
    }

    protected isVisibleWidget(widget: Widget): boolean {
        return !widget.isDisposed && widget.isVisible;
    }

    protected updateFocusedView(): void {
        const widget = this.shell.activeWidget;
        if (widget instanceof PluginViewWidget) {
            this.viewContextKeys.focusedView.set(widget.options.viewId);
        } else {
            this.viewContextKeys.focusedView.reset();
        }
    }
}

