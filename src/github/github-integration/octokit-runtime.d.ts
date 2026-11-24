import type { OctokitClient, OctokitGraphqlClient, OctokitOptions } from './octokit-types.js'
export declare const Octokit: new (options?: OctokitOptions) => OctokitClient
export declare const graphql: OctokitGraphqlClient
