// *****************************************************************************
// Copyright (C) 2023 Ericsson and others.
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

import { OVSXClient, VSXQueryOptions, VSXQueryResult, VSXSearchOptions, VSXSearchResult } from './ovsx-types';
import { RequestContext, RequestService, RequestOptions } from '@theia/request';
import { RateLimiter } from 'limiter';

export const OVSX_RATE_LIMIT = 15;

export class OVSXHttpClient implements OVSXClient {

    // Visual Studio Marketplace API endpoint for both search and query operations
    protected static readonly VS_MARKETPLACE_API = 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery';

    /**
     * @param requestService
     * @returns factory that will cache clients based on the requested input URL.
     */
    static createClientFactory(requestService: RequestService, rateLimiter?: RateLimiter): (url: string) => OVSXClient {
        // eslint-disable-next-line no-null/no-null
        const cachedClients: Record<string, OVSXClient> = Object.create(null);
        return url => cachedClients[url] ??= new this(url, requestService, rateLimiter);
    }

    constructor(
        protected vsxRegistryUrl: string,
        protected requestService: RequestService,
        protected rateLimiter = new RateLimiter({ tokensPerInterval: OVSX_RATE_LIMIT, interval: 'second' })
    ) { }

    async search(searchOptions?: VSXSearchOptions): Promise<VSXSearchResult> {
        // Transform search options to VS Marketplace compatible format
        const requestBody = this.transformSearchOptionsToRequestBody(searchOptions);
        return this.postRequest<VSXSearchResult>(OVSXHttpClient.VS_MARKETPLACE_API, requestBody);
    }

    async query(queryOptions?: VSXQueryOptions): Promise<VSXQueryResult> {
        // Transform query options to VS Marketplace compatible format
        const requestBody = this.transformQueryOptionsToRequestBody(queryOptions);
        return this.postRequest<VSXQueryResult>(OVSXHttpClient.VS_MARKETPLACE_API, requestBody);
    }

    /**
     * Transforms the search options to a format expected by VS Marketplace API
     */
    protected transformSearchOptionsToRequestBody(options?: VSXSearchOptions): Record<string, unknown> {
        return {
            filters: [{
                criteria: [
                    { filterType: 8, value: options?.query || '' },
                    // Add more criteria as needed based on searchOptions
                ],
                pageNumber: 1,  // Use default page number
                pageSize: 50,   // Use default page size
                sortBy: 0,      // Use default sort by
                sortOrder: 0    // Use default sort order
            }],
            flags: 0            // Use default flags
        };
    }

    /**
     * Transforms the query options to a format expected by VS Marketplace API
     */
    protected transformQueryOptionsToRequestBody(options?: VSXQueryOptions): Record<string, unknown> {
        return {
            filters: [{
                criteria: [
                    // Add criteria based on queryOptions
                    ...(options?.extensionId ? [{ filterType: 7, value: options.extensionId }] : []),
                    ...(options?.extensionName ? [{ filterType: 1, value: options.extensionName }] : []),
                    // Add more criteria as needed
                ],
                pageNumber: 1,  // Use default page number
                pageSize: 50    // Use default page size
            }],
            flags: 0            // Use default flags
        };
    }

    /**
     * Sends a POST request to the specified URL with the given body
     */
    protected async postRequest<R>(url: string, body: Record<string, unknown>): Promise<R> {
        const attempts = 5;
        for (let i = 0; i < attempts; i++) {
            const tokenCount = Math.pow(2, i);
            await this.rateLimiter.removeTokens(tokenCount);

            const jsonBody = JSON.stringify(body);

            const requestOptions: RequestOptions = {
                url,
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                data: jsonBody // <-- Use 'data' instead of 'body'
            };

            const context = await this.requestService.request(requestOptions);

            if (context.res.statusCode === 429) {
                console.warn('VS Marketplace rate limit exceeded. Consider reducing the rate limit.');
                if (i < attempts - 1) {
                    continue;
                }
            }

            return RequestContext.asJson<R>(context);
        }

        throw new Error('Failed to fetch data from VS Marketplace.');
    }
}

// // *****************************************************************************
// // Copyright (C) 2023 Ericsson and others.
// //
// // This program and the accompanying materials are made available under the
// // terms of the Eclipse Public License v. 2.0 which is available at
// // http://www.eclipse.org/legal/epl-2.0.
// //
// // This Source Code may also be made available under the following Secondary
// // Licenses when the conditions for such availability set forth in the Eclipse
// // Public License v. 2.0 are satisfied: GNU General Public License, version 2
// // with the GNU Classpath Exception which is available at
// // https://www.gnu.org/software/classpath/license.html.
// //
// // SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// // *****************************************************************************

// import { OVSXClient, VSXQueryOptions, VSXQueryResult, VSXSearchOptions, VSXSearchResult } from './ovsx-types';
// import { RequestContext, RequestService } from '@theia/request';
// import { RateLimiter } from 'limiter';

// export const OVSX_RATE_LIMIT = 15;

// export class OVSXHttpClient implements OVSXClient {

//     /**
//      * @param requestService
//      * @returns factory that will cache clients based on the requested input URL.
//      */
//     static createClientFactory(requestService: RequestService, rateLimiter?: RateLimiter): (url: string) => OVSXClient {
//         // eslint-disable-next-line no-null/no-null
//         const cachedClients: Record<string, OVSXClient> = Object.create(null);
//         return url => cachedClients[url] ??= new this(url, requestService, rateLimiter);
//     }

//     constructor(
//         protected vsxRegistryUrl: string,
//         protected requestService: RequestService,
//         protected rateLimiter = new RateLimiter({ tokensPerInterval: OVSX_RATE_LIMIT, interval: 'second' })
//     ) { }

//     search(searchOptions?: VSXSearchOptions): Promise<VSXSearchResult> {
//         return this.requestJson(this.buildUrl('api/-/search', searchOptions));
//     }

//     query(queryOptions?: VSXQueryOptions): Promise<VSXQueryResult> {
//         return this.requestJson(this.buildUrl('api/v2/-/query', queryOptions));
//     }

//     protected async requestJson<R>(url: string): Promise<R> {
//         const attempts = 5;
//         for (let i = 0; i < attempts; i++) {
//             // Use 1, 2, 4, 8, 16 tokens for each attempt
//             const tokenCount = Math.pow(2, i);
//             await this.rateLimiter.removeTokens(tokenCount);
//             const context = await this.requestService.request({
//                 url,
//                 headers: { 'Accept': 'application/json' }
//             });
//             if (context.res.statusCode === 429) {
//                 console.warn('OVSX rate limit exceeded. Consider reducing the rate limit.');
//                 // If there are still more attempts left, retry the request with a higher token count
//                 if (i < attempts - 1) {
//                     continue;
//                 }
//             }
//             return RequestContext.asJson<R>(context);
//         }
//         throw new Error('Failed to fetch data from OVSX.');
//     }

//     protected buildUrl(url: string, query?: object): string {
//         return new URL(`${url}${this.buildQueryString(query)}`, this.vsxRegistryUrl).toString();
//     }

//     protected buildQueryString(searchQuery?: object): string {
//         if (!searchQuery) {
//             return '';
//         }
//         let queryString = '';
//         for (const [key, value] of Object.entries(searchQuery)) {
//             if (typeof value === 'string') {
//                 queryString += `&${key}=${encodeURIComponent(value)}`;
//             } else if (typeof value === 'boolean' || typeof value === 'number') {
//                 queryString += `&${key}=${value}`;
//             }
//         }
//         return queryString && '?' + queryString.slice(1);
//     }
// }
