/// <reference types="node" />
/// <reference types="node" />
/// <reference types="node" />
/// <reference types="node" />
import * as http from 'node:http';
import * as https from 'node:https';
import * as stream from 'node:stream';
import { CredentialProvider } from "../CredentialProvider.mjs";
import { LEGAL_HOLD_STATUS } from "../helpers.mjs";
import { Extensions } from "./extensions.mjs";
import type { Region } from "./s3-endpoints.mjs";
import type { Binary, BucketItemFromList, BucketItemStat, BucketStream, BucketVersioningConfiguration, GetObjectLegalHoldOptions, IncompleteUploadedBucketItem, IRequest, ItemBucketMetadata, ObjectLockInfo, ObjectMetaData, PutObjectLegalHoldOptions, ReplicationConfig, ReplicationConfigOpts, RequestHeaders, ResultCallback, Retention, StatObjectOpts, Tag, Transport, UploadedObjectInfo, VersionIdentificator } from "./type.mjs";
import type { ListMultipartResult, UploadedPart } from "./xml-parser.mjs";
declare const requestOptionProperties: readonly ["agent", "ca", "cert", "ciphers", "clientCertEngine", "crl", "dhparam", "ecdhCurve", "family", "honorCipherOrder", "key", "passphrase", "pfx", "rejectUnauthorized", "secureOptions", "secureProtocol", "servername", "sessionIdContext"];
export interface ClientOptions {
  endPoint: string;
  accessKey: string;
  secretKey: string;
  useSSL?: boolean;
  port?: number;
  region?: Region;
  transport?: Transport;
  sessionToken?: string;
  partSize?: number;
  pathStyle?: boolean;
  credentialsProvider?: CredentialProvider;
  s3AccelerateEndpoint?: string;
  transportAgent?: http.Agent;
}
export type RequestOption = Partial<IRequest> & {
  method: string;
  bucketName?: string;
  objectName?: string;
  query?: string;
  pathStyle?: boolean;
};
export type NoResultCallback = (error: unknown) => void;
export interface MakeBucketOpt {
  ObjectLocking?: boolean;
}
export interface RemoveOptions {
  versionId?: string;
  governanceBypass?: boolean;
  forceDelete?: boolean;
}
export declare class TypedClient {
  protected transport: Transport;
  protected host: string;
  protected port: number;
  protected protocol: string;
  protected accessKey: string;
  protected secretKey: string;
  protected sessionToken?: string;
  protected userAgent: string;
  protected anonymous: boolean;
  protected pathStyle: boolean;
  protected regionMap: Record<string, string>;
  region?: string;
  protected credentialsProvider?: CredentialProvider;
  partSize: number;
  protected overRidePartSize?: boolean;
  protected maximumPartSize: number;
  protected maxObjectSize: number;
  enableSHA256: boolean;
  protected s3AccelerateEndpoint?: string;
  protected reqOptions: Record<string, unknown>;
  protected transportAgent: http.Agent;
  private readonly clientExtensions;
  constructor(params: ClientOptions);
  /**
   * Minio extensions that aren't necessary present for Amazon S3 compatible storage servers
   */
  get extensions(): Extensions;
  /**
   * @param endPoint - valid S3 acceleration end point
   */
  setS3TransferAccelerate(endPoint: string): void;
  /**
   * Sets the supported request options.
   */
  setRequestOptions(options: Pick<https.RequestOptions, (typeof requestOptionProperties)[number]>): void;
  /**
   *  This is s3 Specific and does not hold validity in any other Object storage.
   */
  private getAccelerateEndPointIfSet;
  /**
   * returns options object that can be used with http.request()
   * Takes care of constructing virtual-host-style or path-style hostname
   */
  protected getRequestOptions(opts: RequestOption & {
    region: string;
  }): IRequest & {
    host: string;
    headers: Record<string, string>;
  };
  setCredentialsProvider(credentialsProvider: CredentialProvider): Promise<void>;
  private checkAndRefreshCreds;
  private logStream?;
  /**
   * log the request, response, error
   */
  private logHTTP;
  /**
   * Enable tracing
   */
  traceOn(stream?: stream.Writable): void;
  /**
   * Disable tracing
   */
  traceOff(): void;
  /**
   * makeRequest is the primitive used by the apis for making S3 requests.
   * payload can be empty string in case of no payload.
   * statusCode is the expected statusCode. If response.statusCode does not match
   * we parse the XML error and call the callback with the error message.
   *
   * A valid region is passed by the calls - listBuckets, makeBucket and getBucketRegion.
   *
   * @internal
   */
  makeRequestAsync(options: RequestOption, payload?: Binary, expectedCodes?: number[], region?: string): Promise<http.IncomingMessage>;
  /**
   * new request with promise
   *
   * No need to drain response, response body is not valid
   */
  makeRequestAsyncOmit(options: RequestOption, payload?: Binary, statusCodes?: number[], region?: string): Promise<Omit<http.IncomingMessage, 'on'>>;
  /**
   * makeRequestStream will be used directly instead of makeRequest in case the payload
   * is available as a stream. for ex. putObject
   *
   * @internal
   */
  makeRequestStreamAsync(options: RequestOption, body: stream.Readable | Binary, sha256sum: string, statusCodes: number[], region: string): Promise<http.IncomingMessage>;
  /**
   * gets the region of the bucket
   *
   * @param bucketName
   *
   * @internal
   */
  protected getBucketRegionAsync(bucketName: string): Promise<string>;
  /**
   * makeRequest is the primitive used by the apis for making S3 requests.
   * payload can be empty string in case of no payload.
   * statusCode is the expected statusCode. If response.statusCode does not match
   * we parse the XML error and call the callback with the error message.
   * A valid region is passed by the calls - listBuckets, makeBucket and
   * getBucketRegion.
   *
   * @deprecated use `makeRequestAsync` instead
   */
  makeRequest(options: RequestOption, payload: Binary | undefined, expectedCodes: number[] | undefined, region: string | undefined, returnResponse: boolean, cb: (cb: unknown, result: http.IncomingMessage) => void): void;
  /**
   * makeRequestStream will be used directly instead of makeRequest in case the payload
   * is available as a stream. for ex. putObject
   *
   * @deprecated use `makeRequestStreamAsync` instead
   */
  makeRequestStream(options: RequestOption, stream: stream.Readable | Buffer, sha256sum: string, statusCodes: number[], region: string, returnResponse: boolean, cb: (cb: unknown, result: http.IncomingMessage) => void): void;
  /**
   * @deprecated use `getBucketRegionAsync` instead
   */
  getBucketRegion(bucketName: string, cb: (err: unknown, region: string) => void): Promise<void>;
  /**
   * Creates the bucket `bucketName`.
   *
   */
  makeBucket(bucketName: string, region?: Region, makeOpts?: MakeBucketOpt): Promise<void>;
  /**
   * To check if a bucket already exists.
   */
  bucketExists(bucketName: string): Promise<boolean>;
  removeBucket(bucketName: string): Promise<void>;
  /**
   * @deprecated use promise style API
   */
  removeBucket(bucketName: string, callback: NoResultCallback): void;
  /**
   * Callback is called with readable stream of the object content.
   */
  getObject(bucketName: string, objectName: string, getOpts?: VersionIdentificator): Promise<stream.Readable>;
  /**
   * Callback is called with readable stream of the partial object content.
   * @param bucketName
   * @param objectName
   * @param offset
   * @param length - length of the object that will be read in the stream (optional, if not specified we read the rest of the file from the offset)
   * @param getOpts
   */
  getPartialObject(bucketName: string, objectName: string, offset: number, length?: number, getOpts?: VersionIdentificator): Promise<stream.Readable>;
  /**
   * download object content to a file.
   * This method will create a temp file named `${filename}.${etag}.part.minio` when downloading.
   *
   * @param bucketName - name of the bucket
   * @param objectName - name of the object
   * @param filePath - path to which the object data will be written to
   * @param getOpts - Optional object get option
   */
  fGetObject(bucketName: string, objectName: string, filePath: string, getOpts?: VersionIdentificator): Promise<void>;
  /**
   * Stat information of the object.
   */
  statObject(bucketName: string, objectName: string, statOpts?: StatObjectOpts): Promise<BucketItemStat>;
  /**
   * Remove the specified object.
   * @deprecated use new promise style API
   */
  removeObject(bucketName: string, objectName: string, removeOpts: RemoveOptions, callback: NoResultCallback): void;
  /**
   * @deprecated use new promise style API
   */
  removeObject(bucketName: string, objectName: string, callback: NoResultCallback): void;
  removeObject(bucketName: string, objectName: string, removeOpts?: RemoveOptions): Promise<void>;
  listIncompleteUploads(bucket: string, prefix: string, recursive: boolean): BucketStream<IncompleteUploadedBucketItem>;
  /**
   * Called by listIncompleteUploads to fetch a batch of incomplete uploads.
   */
  listIncompleteUploadsQuery(bucketName: string, prefix: string, keyMarker: string, uploadIdMarker: string, delimiter: string): Promise<ListMultipartResult>;
  /**
   * Initiate a new multipart upload.
   * @internal
   */
  initiateNewMultipartUpload(bucketName: string, objectName: string, headers: RequestHeaders): Promise<string>;
  /**
   * Internal Method to abort a multipart upload request in case of any errors.
   *
   * @param bucketName - Bucket Name
   * @param objectName - Object Name
   * @param uploadId - id of a multipart upload to cancel during compose object sequence.
   */
  abortMultipartUpload(bucketName: string, objectName: string, uploadId: string): Promise<void>;
  findUploadId(bucketName: string, objectName: string): Promise<string | undefined>;
  /**
   * this call will aggregate the parts on the server into a single object.
   */
  completeMultipartUpload(bucketName: string, objectName: string, uploadId: string, etags: {
    part: number;
    etag?: string;
  }[]): Promise<{
    etag: string;
    versionId: string | null;
  }>;
  /**
   * Get part-info of all parts of an incomplete upload specified by uploadId.
   */
  protected listParts(bucketName: string, objectName: string, uploadId: string): Promise<UploadedPart[]>;
  /**
   * Called by listParts to fetch a batch of part-info
   */
  private listPartsQuery;
  listBuckets(): Promise<BucketItemFromList[]>;
  /**
   * Calculate part size given the object size. Part size will be atleast this.partSize
   */
  calculatePartSize(size: number): number;
  /**
   * Uploads the object using contents from a file
   */
  fPutObject(bucketName: string, objectName: string, filePath: string, metaData?: ObjectMetaData): Promise<void>;
  /**
   *  Uploading a stream, "Buffer" or "string".
   *  It's recommended to pass `size` argument with stream.
   */
  putObject(bucketName: string, objectName: string, stream: stream.Readable | Buffer | string, size?: number, metaData?: ItemBucketMetadata): Promise<UploadedObjectInfo>;
  /**
   * method to upload buffer in one call
   * @private
   */
  private uploadBuffer;
  /**
   * upload stream with MultipartUpload
   * @private
   */
  private uploadStream;
  removeBucketReplication(bucketName: string): Promise<void>;
  removeBucketReplication(bucketName: string, callback: NoResultCallback): void;
  setBucketReplication(bucketName: string, replicationConfig: ReplicationConfigOpts): void;
  setBucketReplication(bucketName: string, replicationConfig: ReplicationConfigOpts): Promise<void>;
  getBucketReplication(bucketName: string): void;
  getBucketReplication(bucketName: string): Promise<ReplicationConfig>;
  getObjectLegalHold(bucketName: string, objectName: string, getOpts?: GetObjectLegalHoldOptions, callback?: ResultCallback<LEGAL_HOLD_STATUS>): Promise<LEGAL_HOLD_STATUS>;
  setObjectLegalHold(bucketName: string, objectName: string, setOpts?: PutObjectLegalHoldOptions): void;
  /**
   * Get Tags associated with a Bucket
   */
  getBucketTagging(bucketName: string): Promise<Tag[]>;
  /**
   *  Get the tags associated with a bucket OR an object
   */
  getObjectTagging(bucketName: string, objectName: string, getOpts?: VersionIdentificator): Promise<Tag[]>;
  /**
   *  Set the policy on a bucket or an object prefix.
   */
  setBucketPolicy(bucketName: string, policy: string): Promise<void>;
  /**
   * Get the policy on a bucket or an object prefix.
   */
  getBucketPolicy(bucketName: string): Promise<string>;
  putObjectRetention(bucketName: string, objectName: string, retentionOpts?: Retention): Promise<void>;
  getObjectLockConfig(bucketName: string, callback: ResultCallback<ObjectLockInfo>): void;
  getObjectLockConfig(bucketName: string): void;
  getObjectLockConfig(bucketName: string): Promise<ObjectLockInfo>;
  setObjectLockConfig(bucketName: string, lockConfigOpts: Omit<ObjectLockInfo, 'objectLockEnabled'>): void;
  setObjectLockConfig(bucketName: string, lockConfigOpts: Omit<ObjectLockInfo, 'objectLockEnabled'>): Promise<void>;
  getBucketVersioning(bucketName: string): Promise<void>;
  setBucketVersioning(bucketName: string, versionConfig: BucketVersioningConfiguration): Promise<void>;
}
export {};