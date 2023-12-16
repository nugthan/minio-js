import * as crypto from "crypto";
import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import * as path from "path";
import * as stream from "stream";
import * as async from 'async';
import BlockStream2 from 'block-stream2';
import { isBrowser } from 'browser-or-node';
import _ from 'lodash';
import * as qs from 'query-string';
import xml2js from 'xml2js';
import { CredentialProvider } from "../CredentialProvider.mjs";
import * as errors from "../errors.mjs";
import { DEFAULT_REGION, LEGAL_HOLD_STATUS, RETENTION_MODES, RETENTION_VALIDITY_UNITS } from "../helpers.mjs";
import { signV4 } from "../signing.mjs";
import { fsp, streamPromise } from "./async.mjs";
import { Extensions } from "./extensions.mjs";
import { extractMetadata, getContentLength, getVersionId, hashBinary, insertContentType, isAmazonEndpoint, isBoolean, isDefined, isEmpty, isNumber, isObject, isReadableStream, isString, isValidBucketName, isValidEndpoint, isValidObjectName, isValidPort, isValidPrefix, isVirtualHostStyle, makeDateLong, prependXAMZMeta, readableStream, sanitizeETag, toMd5, toSha256, uriEscape, uriResourceEscape } from "./helper.mjs";
import { joinHostPort } from "./join-host-port.mjs";
import { request } from "./request.mjs";
import { drainResponse, readAsBuffer, readAsString } from "./response.mjs";
import { getS3Endpoint } from "./s3-endpoints.mjs";
import * as xmlParsers from "./xml-parser.mjs";
import { parseCompleteMultipart, parseInitiateMultipart, parseObjectLegalHoldConfig } from "./xml-parser.mjs";
const xml = new xml2js.Builder({
  renderOpts: {
    pretty: false
  },
  headless: true
});

// will be replaced by bundler.
const Package = {
  version: "7.1.4" || 'development'
};
const requestOptionProperties = ['agent', 'ca', 'cert', 'ciphers', 'clientCertEngine', 'crl', 'dhparam', 'ecdhCurve', 'family', 'honorCipherOrder', 'key', 'passphrase', 'pfx', 'rejectUnauthorized', 'secureOptions', 'secureProtocol', 'servername', 'sessionIdContext'];
export class TypedClient {
  partSize = 64 * 1024 * 1024;
  maximumPartSize = 5 * 1024 * 1024 * 1024;
  maxObjectSize = 5 * 1024 * 1024 * 1024 * 1024;
  constructor(params) {
    // @ts-expect-error deprecated property
    if (params.secure !== undefined) {
      throw new Error('"secure" option deprecated, "useSSL" should be used instead');
    }
    // Default values if not specified.
    if (params.useSSL === undefined) {
      params.useSSL = true;
    }
    if (!params.port) {
      params.port = 0;
    }
    // Validate input params.
    if (!isValidEndpoint(params.endPoint)) {
      throw new errors.InvalidEndpointError(`Invalid endPoint : ${params.endPoint}`);
    }
    if (!isValidPort(params.port)) {
      throw new errors.InvalidArgumentError(`Invalid port : ${params.port}`);
    }
    if (!isBoolean(params.useSSL)) {
      throw new errors.InvalidArgumentError(`Invalid useSSL flag type : ${params.useSSL}, expected to be of type "boolean"`);
    }

    // Validate region only if its set.
    if (params.region) {
      if (!isString(params.region)) {
        throw new errors.InvalidArgumentError(`Invalid region : ${params.region}`);
      }
    }
    const host = params.endPoint.toLowerCase();
    let port = params.port;
    let protocol;
    let transport;
    let transportAgent;
    // Validate if configuration is not using SSL
    // for constructing relevant endpoints.
    if (params.useSSL) {
      // Defaults to secure.
      transport = https;
      protocol = 'https:';
      port = port || 443;
      transportAgent = https.globalAgent;
    } else {
      transport = http;
      protocol = 'http:';
      port = port || 80;
      transportAgent = http.globalAgent;
    }

    // if custom transport is set, use it.
    if (params.transport) {
      if (!isObject(params.transport)) {
        throw new errors.InvalidArgumentError(`Invalid transport type : ${params.transport}, expected to be type "object"`);
      }
      transport = params.transport;
    }

    // if custom transport agent is set, use it.
    if (params.transportAgent) {
      if (!isObject(params.transportAgent)) {
        throw new errors.InvalidArgumentError(`Invalid transportAgent type: ${params.transportAgent}, expected to be type "object"`);
      }
      transportAgent = params.transportAgent;
    }

    // User Agent should always following the below style.
    // Please open an issue to discuss any new changes here.
    //
    //       MinIO (OS; ARCH) LIB/VER APP/VER
    //
    const libraryComments = `(${process.platform}; ${process.arch})`;
    const libraryAgent = `MinIO ${libraryComments} minio-js/${Package.version}`;
    // User agent block ends.

    this.transport = transport;
    this.transportAgent = transportAgent;
    this.host = host;
    this.port = port;
    this.protocol = protocol;
    this.userAgent = `${libraryAgent}`;

    // Default path style is true
    if (params.pathStyle === undefined) {
      this.pathStyle = true;
    } else {
      this.pathStyle = params.pathStyle;
    }
    this.accessKey = params.accessKey ?? '';
    this.secretKey = params.secretKey ?? '';
    this.sessionToken = params.sessionToken;
    this.anonymous = !this.accessKey || !this.secretKey;
    if (params.credentialsProvider) {
      this.credentialsProvider = params.credentialsProvider;
    }
    this.regionMap = {};
    if (params.region) {
      this.region = params.region;
    }
    if (params.partSize) {
      this.partSize = params.partSize;
      this.overRidePartSize = true;
    }
    if (this.partSize < 5 * 1024 * 1024) {
      throw new errors.InvalidArgumentError(`Part size should be greater than 5MB`);
    }
    if (this.partSize > 5 * 1024 * 1024 * 1024) {
      throw new errors.InvalidArgumentError(`Part size should be less than 5GB`);
    }

    // SHA256 is enabled only for authenticated http requests. If the request is authenticated
    // and the connection is https we use x-amz-content-sha256=UNSIGNED-PAYLOAD
    // header for signature calculation.
    this.enableSHA256 = !this.anonymous && !params.useSSL;
    this.s3AccelerateEndpoint = params.s3AccelerateEndpoint || undefined;
    this.reqOptions = {};
    this.clientExtensions = new Extensions(this);
  }

  /**
   * Minio extensions that aren't necessary present for Amazon S3 compatible storage servers
   */
  get extensions() {
    return this.clientExtensions;
  }

  /**
   * @param endPoint - valid S3 acceleration end point
   */
  setS3TransferAccelerate(endPoint) {
    this.s3AccelerateEndpoint = endPoint;
  }

  /**
   * Sets the supported request options.
   */
  setRequestOptions(options) {
    if (!isObject(options)) {
      throw new TypeError('request options should be of type "object"');
    }
    this.reqOptions = _.pick(options, requestOptionProperties);
  }

  /**
   *  This is s3 Specific and does not hold validity in any other Object storage.
   */
  getAccelerateEndPointIfSet(bucketName, objectName) {
    if (!isEmpty(this.s3AccelerateEndpoint) && !isEmpty(bucketName) && !isEmpty(objectName)) {
      // http://docs.aws.amazon.com/AmazonS3/latest/dev/transfer-acceleration.html
      // Disable transfer acceleration for non-compliant bucket names.
      if (bucketName.includes('.')) {
        throw new Error(`Transfer Acceleration is not supported for non compliant bucket:${bucketName}`);
      }
      // If transfer acceleration is requested set new host.
      // For more details about enabling transfer acceleration read here.
      // http://docs.aws.amazon.com/AmazonS3/latest/dev/transfer-acceleration.html
      return this.s3AccelerateEndpoint;
    }
    return false;
  }

  /**
   * returns options object that can be used with http.request()
   * Takes care of constructing virtual-host-style or path-style hostname
   */
  getRequestOptions(opts) {
    const method = opts.method;
    const region = opts.region;
    const bucketName = opts.bucketName;
    let objectName = opts.objectName;
    const headers = opts.headers;
    const query = opts.query;
    let reqOptions = {
      method,
      headers: {},
      protocol: this.protocol,
      // If custom transportAgent was supplied earlier, we'll inject it here
      agent: this.transportAgent
    };

    // Verify if virtual host supported.
    let virtualHostStyle;
    if (bucketName) {
      virtualHostStyle = isVirtualHostStyle(this.host, this.protocol, bucketName, this.pathStyle);
    }
    let path = '/';
    let host = this.host;
    let port;
    if (this.port) {
      port = this.port;
    }
    if (objectName) {
      objectName = uriResourceEscape(objectName);
    }

    // For Amazon S3 endpoint, get endpoint based on region.
    if (isAmazonEndpoint(host)) {
      const accelerateEndPoint = this.getAccelerateEndPointIfSet(bucketName, objectName);
      if (accelerateEndPoint) {
        host = `${accelerateEndPoint}`;
      } else {
        host = getS3Endpoint(region);
      }
    }
    if (virtualHostStyle && !opts.pathStyle) {
      // For all hosts which support virtual host style, `bucketName`
      // is part of the hostname in the following format:
      //
      //  var host = 'bucketName.example.com'
      //
      if (bucketName) {
        host = `${bucketName}.${host}`;
      }
      if (objectName) {
        path = `/${objectName}`;
      }
    } else {
      // For all S3 compatible storage services we will fallback to
      // path style requests, where `bucketName` is part of the URI
      // path.
      if (bucketName) {
        path = `/${bucketName}`;
      }
      if (objectName) {
        path = `/${bucketName}/${objectName}`;
      }
    }
    if (query) {
      path += `?${query}`;
    }
    reqOptions.headers.host = host;
    if (reqOptions.protocol === 'http:' && port !== 80 || reqOptions.protocol === 'https:' && port !== 443) {
      reqOptions.headers.host = joinHostPort(host, port);
    }
    reqOptions.headers['user-agent'] = this.userAgent;
    if (headers) {
      // have all header keys in lower case - to make signing easy
      for (const [k, v] of Object.entries(headers)) {
        reqOptions.headers[k.toLowerCase()] = v;
      }
    }

    // Use any request option specified in minioClient.setRequestOptions()
    reqOptions = Object.assign({}, this.reqOptions, reqOptions);
    return {
      ...reqOptions,
      headers: _.mapValues(_.pickBy(reqOptions.headers, isDefined), v => v.toString()),
      host,
      port,
      path
    };
  }
  async setCredentialsProvider(credentialsProvider) {
    if (!(credentialsProvider instanceof CredentialProvider)) {
      throw new Error('Unable to get credentials. Expected instance of CredentialProvider');
    }
    this.credentialsProvider = credentialsProvider;
    await this.checkAndRefreshCreds();
  }
  async checkAndRefreshCreds() {
    if (this.credentialsProvider) {
      try {
        const credentialsConf = await this.credentialsProvider.getCredentials();
        this.accessKey = credentialsConf.getAccessKey();
        this.secretKey = credentialsConf.getSecretKey();
        this.sessionToken = credentialsConf.getSessionToken();
      } catch (e) {
        throw new Error(`Unable to get credentials: ${e}`, {
          cause: e
        });
      }
    }
  }
  /**
   * log the request, response, error
   */
  logHTTP(reqOptions, response, err) {
    // if no logStream available return.
    if (!this.logStream) {
      return;
    }
    if (!isObject(reqOptions)) {
      throw new TypeError('reqOptions should be of type "object"');
    }
    if (response && !isReadableStream(response)) {
      throw new TypeError('response should be of type "Stream"');
    }
    if (err && !(err instanceof Error)) {
      throw new TypeError('err should be of type "Error"');
    }
    const logStream = this.logStream;
    const logHeaders = headers => {
      Object.entries(headers).forEach(([k, v]) => {
        if (k == 'authorization') {
          if (isString(v)) {
            const redactor = new RegExp('Signature=([0-9a-f]+)');
            v = v.replace(redactor, 'Signature=**REDACTED**');
          }
        }
        logStream.write(`${k}: ${v}\n`);
      });
      logStream.write('\n');
    };
    logStream.write(`REQUEST: ${reqOptions.method} ${reqOptions.path}\n`);
    logHeaders(reqOptions.headers);
    if (response) {
      this.logStream.write(`RESPONSE: ${response.statusCode}\n`);
      logHeaders(response.headers);
    }
    if (err) {
      logStream.write('ERROR BODY:\n');
      const errJSON = JSON.stringify(err, null, '\t');
      logStream.write(`${errJSON}\n`);
    }
  }

  /**
   * Enable tracing
   */
  traceOn(stream) {
    if (!stream) {
      stream = process.stdout;
    }
    this.logStream = stream;
  }

  /**
   * Disable tracing
   */
  traceOff() {
    this.logStream = undefined;
  }

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
  async makeRequestAsync(options, payload = '', expectedCodes = [200], region = '') {
    if (!isObject(options)) {
      throw new TypeError('options should be of type "object"');
    }
    if (!isString(payload) && !isObject(payload)) {
      // Buffer is of type 'object'
      throw new TypeError('payload should be of type "string" or "Buffer"');
    }
    expectedCodes.forEach(statusCode => {
      if (!isNumber(statusCode)) {
        throw new TypeError('statusCode should be of type "number"');
      }
    });
    if (!isString(region)) {
      throw new TypeError('region should be of type "string"');
    }
    if (!options.headers) {
      options.headers = {};
    }
    if (options.method === 'POST' || options.method === 'PUT' || options.method === 'DELETE') {
      options.headers['content-length'] = payload.length.toString();
    }
    const sha256sum = this.enableSHA256 ? toSha256(payload) : '';
    return this.makeRequestStreamAsync(options, payload, sha256sum, expectedCodes, region);
  }

  /**
   * new request with promise
   *
   * No need to drain response, response body is not valid
   */
  async makeRequestAsyncOmit(options, payload = '', statusCodes = [200], region = '') {
    const res = await this.makeRequestAsync(options, payload, statusCodes, region);
    await drainResponse(res);
    return res;
  }

  /**
   * makeRequestStream will be used directly instead of makeRequest in case the payload
   * is available as a stream. for ex. putObject
   *
   * @internal
   */
  async makeRequestStreamAsync(options, body, sha256sum, statusCodes, region) {
    if (!isObject(options)) {
      throw new TypeError('options should be of type "object"');
    }
    if (!(Buffer.isBuffer(body) || typeof body === 'string' || isReadableStream(body))) {
      throw new errors.InvalidArgumentError(`stream should be a Buffer, string or readable Stream, got ${typeof body} instead`);
    }
    if (!isString(sha256sum)) {
      throw new TypeError('sha256sum should be of type "string"');
    }
    statusCodes.forEach(statusCode => {
      if (!isNumber(statusCode)) {
        throw new TypeError('statusCode should be of type "number"');
      }
    });
    if (!isString(region)) {
      throw new TypeError('region should be of type "string"');
    }
    // sha256sum will be empty for anonymous or https requests
    if (!this.enableSHA256 && sha256sum.length !== 0) {
      throw new errors.InvalidArgumentError(`sha256sum expected to be empty for anonymous or https requests`);
    }
    // sha256sum should be valid for non-anonymous http requests.
    if (this.enableSHA256 && sha256sum.length !== 64) {
      throw new errors.InvalidArgumentError(`Invalid sha256sum : ${sha256sum}`);
    }
    await this.checkAndRefreshCreds();

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    region = region || (await this.getBucketRegionAsync(options.bucketName));
    const reqOptions = this.getRequestOptions({
      ...options,
      region
    });
    if (!this.anonymous) {
      // For non-anonymous https requests sha256sum is 'UNSIGNED-PAYLOAD' for signature calculation.
      if (!this.enableSHA256) {
        sha256sum = 'UNSIGNED-PAYLOAD';
      }
      const date = new Date();
      reqOptions.headers['x-amz-date'] = makeDateLong(date);
      reqOptions.headers['x-amz-content-sha256'] = sha256sum;
      if (this.sessionToken) {
        reqOptions.headers['x-amz-security-token'] = this.sessionToken;
      }
      reqOptions.headers.authorization = signV4(reqOptions, this.accessKey, this.secretKey, region, date, sha256sum);
    }
    const response = await request(this.transport, reqOptions, body);
    if (!response.statusCode) {
      throw new Error("BUG: response doesn't have a statusCode");
    }
    if (!statusCodes.includes(response.statusCode)) {
      // For an incorrect region, S3 server always sends back 400.
      // But we will do cache invalidation for all errors so that,
      // in future, if AWS S3 decides to send a different status code or
      // XML error code we will still work fine.
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      delete this.regionMap[options.bucketName];
      const err = await xmlParsers.parseResponseError(response);
      this.logHTTP(reqOptions, response, err);
      throw err;
    }
    this.logHTTP(reqOptions, response);
    return response;
  }

  /**
   * gets the region of the bucket
   *
   * @param bucketName
   *
   * @internal
   */
  async getBucketRegionAsync(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name : ${bucketName}`);
    }

    // Region is set with constructor, return the region right here.
    if (this.region) {
      return this.region;
    }
    const cached = this.regionMap[bucketName];
    if (cached) {
      return cached;
    }
    const extractRegionAsync = async response => {
      const body = await readAsString(response);
      const region = xmlParsers.parseBucketRegion(body) || DEFAULT_REGION;
      this.regionMap[bucketName] = region;
      return region;
    };
    const method = 'GET';
    const query = 'location';
    // `getBucketLocation` behaves differently in following ways for
    // different environments.
    //
    // - For nodejs env we default to path style requests.
    // - For browser env path style requests on buckets yields CORS
    //   error. To circumvent this problem we make a virtual host
    //   style request signed with 'us-east-1'. This request fails
    //   with an error 'AuthorizationHeaderMalformed', additionally
    //   the error XML also provides Region of the bucket. To validate
    //   this region is proper we retry the same request with the newly
    //   obtained region.
    const pathStyle = this.pathStyle && !isBrowser;
    let region;
    try {
      const res = await this.makeRequestAsync({
        method,
        bucketName,
        query,
        pathStyle
      }, '', [200], DEFAULT_REGION);
      return extractRegionAsync(res);
    } catch (e) {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      if (!(e.name === 'AuthorizationHeaderMalformed')) {
        throw e;
      }
      // @ts-expect-error we set extra properties on error object
      region = e.Region;
      if (!region) {
        throw e;
      }
    }
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      query,
      pathStyle
    }, '', [200], region);
    return await extractRegionAsync(res);
  }

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
  makeRequest(options, payload = '', expectedCodes = [200], region = '', returnResponse, cb) {
    let prom;
    if (returnResponse) {
      prom = this.makeRequestAsync(options, payload, expectedCodes, region);
    } else {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error compatible for old behaviour
      prom = this.makeRequestAsyncOmit(options, payload, expectedCodes, region);
    }
    prom.then(result => cb(null, result), err => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      cb(err);
    });
  }

  /**
   * makeRequestStream will be used directly instead of makeRequest in case the payload
   * is available as a stream. for ex. putObject
   *
   * @deprecated use `makeRequestStreamAsync` instead
   */
  makeRequestStream(options, stream, sha256sum, statusCodes, region, returnResponse, cb) {
    const executor = async () => {
      const res = await this.makeRequestStreamAsync(options, stream, sha256sum, statusCodes, region);
      if (!returnResponse) {
        await drainResponse(res);
      }
      return res;
    };
    executor().then(result => cb(null, result),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    err => cb(err));
  }

  /**
   * @deprecated use `getBucketRegionAsync` instead
   */
  getBucketRegion(bucketName, cb) {
    return this.getBucketRegionAsync(bucketName).then(result => cb(null, result),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    err => cb(err));
  }

  // Bucket operations

  /**
   * Creates the bucket `bucketName`.
   *
   */
  async makeBucket(bucketName, region = '', makeOpts = {}) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    // Backward Compatibility
    if (isObject(region)) {
      makeOpts = region;
      region = '';
    }
    if (!isString(region)) {
      throw new TypeError('region should be of type "string"');
    }
    if (!isObject(makeOpts)) {
      throw new TypeError('makeOpts should be of type "object"');
    }
    let payload = '';

    // Region already set in constructor, validate if
    // caller requested bucket location is same.
    if (region && this.region) {
      if (region !== this.region) {
        throw new errors.InvalidArgumentError(`Configured region ${this.region}, requested ${region}`);
      }
    }
    // sending makeBucket request with XML containing 'us-east-1' fails. For
    // default region server expects the request without body
    if (region && region !== DEFAULT_REGION) {
      payload = xml.buildObject({
        CreateBucketConfiguration: {
          $: {
            xmlns: 'http://s3.amazonaws.com/doc/2006-03-01/'
          },
          LocationConstraint: region
        }
      });
    }
    const method = 'PUT';
    const headers = {};
    if (makeOpts.ObjectLocking) {
      headers['x-amz-bucket-object-lock-enabled'] = true;
    }
    if (!region) {
      region = DEFAULT_REGION;
    }
    const finalRegion = region; // type narrow
    const requestOpt = {
      method,
      bucketName,
      headers
    };
    try {
      await this.makeRequestAsyncOmit(requestOpt, payload, [200], finalRegion);
    } catch (err) {
      if (region === '' || region === DEFAULT_REGION) {
        if (err instanceof errors.S3Error) {
          const errCode = err.code;
          const errRegion = err.region;
          if (errCode === 'AuthorizationHeaderMalformed' && errRegion !== '') {
            // Retry with region returned as part of error
            await this.makeRequestAsyncOmit(requestOpt, payload, [200], errCode);
          }
        }
      }
      throw err;
    }
  }

  /**
   * To check if a bucket already exists.
   */
  async bucketExists(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'HEAD';
    try {
      await this.makeRequestAsyncOmit({
        method,
        bucketName
      });
    } catch (err) {
      // @ts-ignore
      if (err.code === 'NoSuchBucket' || err.code === 'NotFound') {
        return false;
      }
      throw err;
    }
    return true;
  }

  /**
   * @deprecated use promise style API
   */

  async removeBucket(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'DELETE';
    await this.makeRequestAsyncOmit({
      method,
      bucketName
    }, '', [204]);
    delete this.regionMap[bucketName];
  }

  /**
   * Callback is called with readable stream of the object content.
   */
  async getObject(bucketName, objectName, getOpts = {}) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    return this.getPartialObject(bucketName, objectName, 0, 0, getOpts);
  }

  /**
   * Callback is called with readable stream of the partial object content.
   * @param bucketName
   * @param objectName
   * @param offset
   * @param length - length of the object that will be read in the stream (optional, if not specified we read the rest of the file from the offset)
   * @param getOpts
   */
  async getPartialObject(bucketName, objectName, offset, length = 0, getOpts = {}) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isNumber(offset)) {
      throw new TypeError('offset should be of type "number"');
    }
    if (!isNumber(length)) {
      throw new TypeError('length should be of type "number"');
    }
    let range = '';
    if (offset || length) {
      if (offset) {
        range = `bytes=${+offset}-`;
      } else {
        range = 'bytes=0-';
        offset = 0;
      }
      if (length) {
        range += `${+length + offset - 1}`;
      }
    }
    const headers = {};
    if (range !== '') {
      headers.range = range;
    }
    const expectedStatusCodes = [200];
    if (range) {
      expectedStatusCodes.push(206);
    }
    const method = 'GET';
    const query = qs.stringify(getOpts);
    return await this.makeRequestAsync({
      method,
      bucketName,
      objectName,
      headers,
      query
    }, '', expectedStatusCodes);
  }

  /**
   * download object content to a file.
   * This method will create a temp file named `${filename}.${etag}.part.minio` when downloading.
   *
   * @param bucketName - name of the bucket
   * @param objectName - name of the object
   * @param filePath - path to which the object data will be written to
   * @param getOpts - Optional object get option
   */
  async fGetObject(bucketName, objectName, filePath, getOpts = {}) {
    // Input validation.
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isString(filePath)) {
      throw new TypeError('filePath should be of type "string"');
    }
    const downloadToTmpFile = async () => {
      let partFileStream;
      const objStat = await this.statObject(bucketName, objectName, getOpts);
      const partFile = `${filePath}.${objStat.etag}.part.minio`;
      await fsp.mkdir(path.dirname(filePath), {
        recursive: true
      });
      let offset = 0;
      try {
        const stats = await fsp.stat(partFile);
        if (objStat.size === stats.size) {
          return partFile;
        }
        offset = stats.size;
        partFileStream = fs.createWriteStream(partFile, {
          flags: 'a'
        });
      } catch (e) {
        if (e instanceof Error && e.code === 'ENOENT') {
          // file not exist
          partFileStream = fs.createWriteStream(partFile, {
            flags: 'w'
          });
        } else {
          // other error, maybe access deny
          throw e;
        }
      }
      const downloadStream = await this.getPartialObject(bucketName, objectName, offset, 0, getOpts);
      await streamPromise.pipeline(downloadStream, partFileStream);
      const stats = await fsp.stat(partFile);
      if (stats.size === objStat.size) {
        return partFile;
      }
      throw new Error('Size mismatch between downloaded file and the object');
    };
    const partFile = await downloadToTmpFile();
    await fsp.rename(partFile, filePath);
  }

  /**
   * Stat information of the object.
   */
  async statObject(bucketName, objectName, statOpts = {}) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isObject(statOpts)) {
      throw new errors.InvalidArgumentError('statOpts should be of type "object"');
    }
    const query = qs.stringify(statOpts);
    const method = 'HEAD';
    const res = await this.makeRequestAsyncOmit({
      method,
      bucketName,
      objectName,
      query
    });
    return {
      size: parseInt(res.headers['content-length']),
      metaData: extractMetadata(res.headers),
      lastModified: new Date(res.headers['last-modified']),
      versionId: getVersionId(res.headers),
      etag: sanitizeETag(res.headers.etag)
    };
  }

  /**
   * Remove the specified object.
   * @deprecated use new promise style API
   */

  /**
   * @deprecated use new promise style API
   */ // @ts-ignore
  async removeObject(bucketName, objectName, removeOpts = {}) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isObject(removeOpts)) {
      throw new errors.InvalidArgumentError('removeOpts should be of type "object"');
    }
    const method = 'DELETE';
    const headers = {};
    if (removeOpts.governanceBypass) {
      headers['X-Amz-Bypass-Governance-Retention'] = true;
    }
    if (removeOpts.forceDelete) {
      headers['x-minio-force-delete'] = true;
    }
    const queryParams = {};
    if (removeOpts.versionId) {
      queryParams.versionId = `${removeOpts.versionId}`;
    }
    const query = qs.stringify(queryParams);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      objectName,
      headers,
      query
    }, '', [200, 204]);
  }

  // Calls implemented below are related to multipart.

  listIncompleteUploads(bucket, prefix, recursive) {
    if (prefix === undefined) {
      prefix = '';
    }
    if (recursive === undefined) {
      recursive = false;
    }
    if (!isValidBucketName(bucket)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucket);
    }
    if (!isValidPrefix(prefix)) {
      throw new errors.InvalidPrefixError(`Invalid prefix : ${prefix}`);
    }
    if (!isBoolean(recursive)) {
      throw new TypeError('recursive should be of type "boolean"');
    }
    const delimiter = recursive ? '' : '/';
    let keyMarker = '';
    let uploadIdMarker = '';
    const uploads = [];
    let ended = false;

    // TODO: refactor this with async/await and `stream.Readable.from`
    const readStream = new stream.Readable({
      objectMode: true
    });
    readStream._read = () => {
      // push one upload info per _read()
      if (uploads.length) {
        return readStream.push(uploads.shift());
      }
      if (ended) {
        return readStream.push(null);
      }
      this.listIncompleteUploadsQuery(bucket, prefix, keyMarker, uploadIdMarker, delimiter).then(result => {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        result.prefixes.forEach(prefix => uploads.push(prefix));
        async.eachSeries(result.uploads, (upload, cb) => {
          // for each incomplete upload add the sizes of its uploaded parts
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          this.listParts(bucket, upload.key, upload.uploadId).then(parts => {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            upload.size = parts.reduce((acc, item) => acc + item.size, 0);
            uploads.push(upload);
            cb();
          }, err => cb(err));
        }, err => {
          if (err) {
            readStream.emit('error', err);
            return;
          }
          if (result.isTruncated) {
            keyMarker = result.nextKeyMarker;
            uploadIdMarker = result.nextUploadIdMarker;
          } else {
            ended = true;
          }

          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          readStream._read();
        });
      }, e => {
        readStream.emit('error', e);
      });
    };
    return readStream;
  }

  /**
   * Called by listIncompleteUploads to fetch a batch of incomplete uploads.
   */
  async listIncompleteUploadsQuery(bucketName, prefix, keyMarker, uploadIdMarker, delimiter) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isString(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (!isString(keyMarker)) {
      throw new TypeError('keyMarker should be of type "string"');
    }
    if (!isString(uploadIdMarker)) {
      throw new TypeError('uploadIdMarker should be of type "string"');
    }
    if (!isString(delimiter)) {
      throw new TypeError('delimiter should be of type "string"');
    }
    const queries = [];
    queries.push(`prefix=${uriEscape(prefix)}`);
    queries.push(`delimiter=${uriEscape(delimiter)}`);
    if (keyMarker) {
      queries.push(`key-marker=${uriEscape(keyMarker)}`);
    }
    if (uploadIdMarker) {
      queries.push(`upload-id-marker=${uploadIdMarker}`);
    }
    const maxUploads = 1000;
    queries.push(`max-uploads=${maxUploads}`);
    queries.sort();
    queries.unshift('uploads');
    let query = '';
    if (queries.length > 0) {
      query = `${queries.join('&')}`;
    }
    const method = 'GET';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const body = await readAsString(res);
    return xmlParsers.parseListMultipart(body);
  }

  /**
   * Initiate a new multipart upload.
   * @internal
   */
  async initiateNewMultipartUpload(bucketName, objectName, headers) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isObject(headers)) {
      throw new errors.InvalidObjectNameError('contentType should be of type "object"');
    }
    const method = 'POST';
    const query = 'uploads';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      objectName,
      query,
      headers
    });
    const body = await readAsBuffer(res);
    return parseInitiateMultipart(body.toString());
  }

  /**
   * Internal Method to abort a multipart upload request in case of any errors.
   *
   * @param bucketName - Bucket Name
   * @param objectName - Object Name
   * @param uploadId - id of a multipart upload to cancel during compose object sequence.
   */
  async abortMultipartUpload(bucketName, objectName, uploadId) {
    const method = 'DELETE';
    const query = `uploadId=${uploadId}`;
    const requestOptions = {
      method,
      bucketName,
      objectName: objectName,
      query
    };
    await this.makeRequestAsyncOmit(requestOptions, '', [204]);
  }
  async findUploadId(bucketName, objectName) {
    var _latestUpload;
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    let latestUpload;
    let keyMarker = '';
    let uploadIdMarker = '';
    for (;;) {
      const result = await this.listIncompleteUploadsQuery(bucketName, objectName, keyMarker, uploadIdMarker, '');
      for (const upload of result.uploads) {
        if (upload.key === objectName) {
          if (!latestUpload || upload.initiated.getTime() > latestUpload.initiated.getTime()) {
            latestUpload = upload;
          }
        }
      }
      if (result.isTruncated) {
        keyMarker = result.nextKeyMarker;
        uploadIdMarker = result.nextUploadIdMarker;
        continue;
      }
      break;
    }
    return (_latestUpload = latestUpload) === null || _latestUpload === void 0 ? void 0 : _latestUpload.uploadId;
  }

  /**
   * this call will aggregate the parts on the server into a single object.
   */
  async completeMultipartUpload(bucketName, objectName, uploadId, etags) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isString(uploadId)) {
      throw new TypeError('uploadId should be of type "string"');
    }
    if (!isObject(etags)) {
      throw new TypeError('etags should be of type "Array"');
    }
    if (!uploadId) {
      throw new errors.InvalidArgumentError('uploadId cannot be empty');
    }
    const method = 'POST';
    const query = `uploadId=${uriEscape(uploadId)}`;
    const builder = new xml2js.Builder();
    const payload = builder.buildObject({
      CompleteMultipartUpload: {
        $: {
          xmlns: 'http://s3.amazonaws.com/doc/2006-03-01/'
        },
        Part: etags.map(etag => {
          return {
            PartNumber: etag.part,
            ETag: etag.etag
          };
        })
      }
    });
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      objectName,
      query
    }, payload);
    const body = await readAsBuffer(res);
    const result = parseCompleteMultipart(body.toString());
    if (!result) {
      throw new Error('BUG: failed to parse server response');
    }
    if (result.errCode) {
      // Multipart Complete API returns an error XML after a 200 http status
      throw new errors.S3Error(result.errMessage);
    }
    return {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      etag: result.etag,
      versionId: getVersionId(res.headers)
    };
  }

  /**
   * Get part-info of all parts of an incomplete upload specified by uploadId.
   */
  async listParts(bucketName, objectName, uploadId) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isString(uploadId)) {
      throw new TypeError('uploadId should be of type "string"');
    }
    if (!uploadId) {
      throw new errors.InvalidArgumentError('uploadId cannot be empty');
    }
    const parts = [];
    let marker = 0;
    let result;
    do {
      result = await this.listPartsQuery(bucketName, objectName, uploadId, marker);
      marker = result.marker;
      parts.push(...result.parts);
    } while (result.isTruncated);
    return parts;
  }

  /**
   * Called by listParts to fetch a batch of part-info
   */
  async listPartsQuery(bucketName, objectName, uploadId, marker) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isString(uploadId)) {
      throw new TypeError('uploadId should be of type "string"');
    }
    if (!isNumber(marker)) {
      throw new TypeError('marker should be of type "number"');
    }
    if (!uploadId) {
      throw new errors.InvalidArgumentError('uploadId cannot be empty');
    }
    let query = `uploadId=${uriEscape(uploadId)}`;
    if (marker) {
      query += `&part-number-marker=${marker}`;
    }
    const method = 'GET';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      objectName,
      query
    });
    return xmlParsers.parseListParts(await readAsString(res));
  }
  async listBuckets() {
    const method = 'GET';
    const httpRes = await this.makeRequestAsync({
      method
    }, '', [200], DEFAULT_REGION);
    const xmlResult = await readAsString(httpRes);
    return xmlParsers.parseListBucket(xmlResult);
  }

  /**
   * Calculate part size given the object size. Part size will be atleast this.partSize
   */
  calculatePartSize(size) {
    if (!isNumber(size)) {
      throw new TypeError('size should be of type "number"');
    }
    if (size > this.maxObjectSize) {
      throw new TypeError(`size should not be more than ${this.maxObjectSize}`);
    }
    if (this.overRidePartSize) {
      return this.partSize;
    }
    let partSize = this.partSize;
    for (;;) {
      // while(true) {...} throws linting error.
      // If partSize is big enough to accomodate the object size, then use it.
      if (partSize * 10000 > size) {
        return partSize;
      }
      // Try part sizes as 64MB, 80MB, 96MB etc.
      partSize += 16 * 1024 * 1024;
    }
  }

  /**
   * Uploads the object using contents from a file
   */
  async fPutObject(bucketName, objectName, filePath, metaData = {}) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isString(filePath)) {
      throw new TypeError('filePath should be of type "string"');
    }
    if (!isObject(metaData)) {
      throw new TypeError('metaData should be of type "object"');
    }

    // Inserts correct `content-type` attribute based on metaData and filePath
    metaData = insertContentType(metaData, filePath);
    const stat = await fsp.lstat(filePath);
    await this.putObject(bucketName, objectName, fs.createReadStream(filePath), stat.size, metaData);
  }

  /**
   *  Uploading a stream, "Buffer" or "string".
   *  It's recommended to pass `size` argument with stream.
   */
  async putObject(bucketName, objectName, stream, size, metaData) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }

    // We'll need to shift arguments to the left because of metaData
    // and size being optional.
    if (isObject(size)) {
      metaData = size;
    }
    // Ensures Metadata has appropriate prefix for A3 API
    const headers = prependXAMZMeta(metaData);
    if (typeof stream === 'string' || stream instanceof Buffer) {
      // Adapts the non-stream interface into a stream.
      size = stream.length;
      stream = readableStream(stream);
    } else if (!isReadableStream(stream)) {
      throw new TypeError('third argument should be of type "stream.Readable" or "Buffer" or "string"');
    }
    if (isNumber(size) && size < 0) {
      throw new errors.InvalidArgumentError(`size cannot be negative, given size: ${size}`);
    }

    // Get the part size and forward that to the BlockStream. Default to the
    // largest block size possible if necessary.
    if (!isNumber(size)) {
      size = this.maxObjectSize;
    }

    // Get the part size and forward that to the BlockStream. Default to the
    // largest block size possible if necessary.
    if (size === undefined) {
      const statSize = await getContentLength(stream);
      if (statSize !== null) {
        size = statSize;
      }
    }
    if (!isNumber(size)) {
      // Backward compatibility
      size = this.maxObjectSize;
    }
    const partSize = this.calculatePartSize(size);
    if (typeof stream === 'string' || Buffer.isBuffer(stream) || size <= partSize) {
      const buf = isReadableStream(stream) ? await readAsBuffer(stream) : Buffer.from(stream);
      return this.uploadBuffer(bucketName, objectName, headers, buf);
    }
    return this.uploadStream(bucketName, objectName, headers, stream, partSize);
  }

  /**
   * method to upload buffer in one call
   * @private
   */
  async uploadBuffer(bucketName, objectName, headers, buf) {
    const {
      md5sum,
      sha256sum
    } = hashBinary(buf, this.enableSHA256);
    headers['Content-Length'] = buf.length;
    if (!this.enableSHA256) {
      headers['Content-MD5'] = md5sum;
    }
    const res = await this.makeRequestStreamAsync({
      method: 'PUT',
      bucketName,
      objectName,
      headers
    }, buf, sha256sum, [200], '');
    await drainResponse(res);
    return {
      etag: sanitizeETag(res.headers.etag),
      versionId: getVersionId(res.headers)
    };
  }

  /**
   * upload stream with MultipartUpload
   * @private
   */
  async uploadStream(bucketName, objectName, headers, body, partSize) {
    // A map of the previously uploaded chunks, for resuming a file upload. This
    // will be null if we aren't resuming an upload.
    const oldParts = {};

    // Keep track of the etags for aggregating the chunks together later. Each
    // etag represents a single chunk of the file.
    const eTags = [];
    const previousUploadId = await this.findUploadId(bucketName, objectName);
    let uploadId;
    if (!previousUploadId) {
      uploadId = await this.initiateNewMultipartUpload(bucketName, objectName, headers);
    } else {
      uploadId = previousUploadId;
      const oldTags = await this.listParts(bucketName, objectName, previousUploadId);
      oldTags.forEach(e => {
        oldTags[e.part] = e;
      });
    }
    const chunkier = new BlockStream2({
      size: partSize,
      zeroPadding: false
    });
    const [_, o] = await Promise.all([new Promise((resolve, reject) => {
      body.pipe(chunkier).on('error', reject);
      chunkier.on('end', resolve).on('error', reject);
    }), (async () => {
      let partNumber = 1;
      for await (const chunk of chunkier) {
        const md5 = crypto.createHash('md5').update(chunk).digest();
        const oldPart = oldParts[partNumber];
        if (oldPart) {
          if (oldPart.etag === md5.toString('hex')) {
            eTags.push({
              part: partNumber,
              etag: oldPart.etag
            });
            partNumber++;
            continue;
          }
        }
        partNumber++;

        // now start to upload missing part
        const options = {
          method: 'PUT',
          query: qs.stringify({
            partNumber,
            uploadId
          }),
          headers: {
            'Content-Length': chunk.length,
            'Content-MD5': md5.toString('base64')
          },
          bucketName,
          objectName
        };
        const response = await this.makeRequestAsyncOmit(options, chunk);
        let etag = response.headers.etag;
        if (etag) {
          etag = etag.replace(/^"/, '').replace(/"$/, '');
        } else {
          etag = '';
        }
        eTags.push({
          part: partNumber,
          etag
        });
      }
      return await this.completeMultipartUpload(bucketName, objectName, uploadId, eTags);
    })()]);
    return o;
  }
  async removeBucketReplication(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'DELETE';
    const query = 'replication';
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query
    }, '', [200, 204], '');
  }
  async setBucketReplication(bucketName, replicationConfig) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isObject(replicationConfig)) {
      throw new errors.InvalidArgumentError('replicationConfig should be of type "object"');
    } else {
      if (_.isEmpty(replicationConfig.role)) {
        throw new errors.InvalidArgumentError('Role cannot be empty');
      } else if (replicationConfig.role && !isString(replicationConfig.role)) {
        throw new errors.InvalidArgumentError('Invalid value for role', replicationConfig.role);
      }
      if (_.isEmpty(replicationConfig.rules)) {
        throw new errors.InvalidArgumentError('Minimum one replication rule must be specified');
      }
    }
    const method = 'PUT';
    const query = 'replication';
    const headers = {};
    const replicationParamsConfig = {
      ReplicationConfiguration: {
        Role: replicationConfig.role,
        Rule: replicationConfig.rules
      }
    };
    const builder = new xml2js.Builder({
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(replicationParamsConfig);
    headers['Content-MD5'] = toMd5(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query,
      headers
    }, payload);
  }
  async getBucketReplication(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'replication';
    const httpRes = await this.makeRequestAsync({
      method,
      bucketName,
      query
    }, '', [200, 204]);
    const xmlResult = await readAsString(httpRes);
    return xmlParsers.parseReplicationConfig(xmlResult);
  }
  async getObjectLegalHold(bucketName, objectName, getOpts) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (getOpts) {
      if (!isObject(getOpts)) {
        throw new TypeError('getOpts should be of type "Object"');
      } else if (Object.keys(getOpts).length > 0 && getOpts.versionId && !isString(getOpts.versionId)) {
        throw new TypeError('versionId should be of type string.:', getOpts.versionId);
      }
    }
    const method = 'GET';
    let query = 'legal-hold';
    if (getOpts !== null && getOpts !== void 0 && getOpts.versionId) {
      query += `&versionId=${getOpts.versionId}`;
    }
    const httpRes = await this.makeRequestAsync({
      method,
      bucketName,
      objectName,
      query
    }, '', [200]);
    const strRes = await readAsString(httpRes);
    return parseObjectLegalHoldConfig(strRes);
  }
  async setObjectLegalHold(bucketName, objectName, setOpts = {
    status: LEGAL_HOLD_STATUS.ENABLED
  }) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isObject(setOpts)) {
      throw new TypeError('setOpts should be of type "Object"');
    } else {
      if (![LEGAL_HOLD_STATUS.ENABLED, LEGAL_HOLD_STATUS.DISABLED].includes(setOpts === null || setOpts === void 0 ? void 0 : setOpts.status)) {
        throw new TypeError('Invalid status: ' + setOpts.status);
      }
      if (setOpts.versionId && !setOpts.versionId.length) {
        throw new TypeError('versionId should be of type string.:' + setOpts.versionId);
      }
    }
    const method = 'PUT';
    let query = 'legal-hold';
    if (setOpts.versionId) {
      query += `&versionId=${setOpts.versionId}`;
    }
    const config = {
      Status: setOpts.status
    };
    const builder = new xml2js.Builder({
      rootName: 'LegalHold',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(config);
    const headers = {};
    headers['Content-MD5'] = toMd5(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      objectName,
      query,
      headers
    }, payload);
  }

  /**
   * Get Tags associated with a Bucket
   */
  async getBucketTagging(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    const method = 'GET';
    const query = 'tagging';
    const requestOptions = {
      method,
      bucketName,
      query
    };
    const response = await this.makeRequestAsync(requestOptions);
    const body = await readAsString(response);
    return xmlParsers.parseTagging(body);
  }

  /**
   *  Get the tags associated with a bucket OR an object
   */
  async getObjectTagging(bucketName, objectName, getOpts = {}) {
    const method = 'GET';
    let query = 'tagging';
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidBucketNameError('Invalid object name: ' + objectName);
    }
    if (!isObject(getOpts)) {
      throw new errors.InvalidArgumentError('getOpts should be of type "object"');
    }
    if (getOpts && getOpts.versionId) {
      query = `${query}&versionId=${getOpts.versionId}`;
    }
    const requestOptions = {
      method,
      bucketName,
      query
    };
    if (objectName) {
      requestOptions['objectName'] = objectName;
    }
    const response = await this.makeRequestAsync(requestOptions);
    const body = await readAsString(response);
    return xmlParsers.parseTagging(body);
  }

  /**
   *  Set the policy on a bucket or an object prefix.
   */
  async setBucketPolicy(bucketName, policy) {
    // Validate arguments.
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!isString(policy)) {
      throw new errors.InvalidBucketPolicyError(`Invalid bucket policy: ${policy} - must be "string"`);
    }
    const query = 'policy';
    let method = 'DELETE';
    if (policy) {
      method = 'PUT';
    }
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query
    }, policy, [204], '');
  }

  /**
   * Get the policy on a bucket or an object prefix.
   */
  async getBucketPolicy(bucketName) {
    // Validate arguments.
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    const method = 'GET';
    const query = 'policy';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    return await readAsString(res);
  }
  async putObjectRetention(bucketName, objectName, retentionOpts = {}) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isObject(retentionOpts)) {
      throw new errors.InvalidArgumentError('retentionOpts should be of type "object"');
    } else {
      if (retentionOpts.governanceBypass && !isBoolean(retentionOpts.governanceBypass)) {
        throw new errors.InvalidArgumentError(`Invalid value for governanceBypass: ${retentionOpts.governanceBypass}`);
      }
      if (retentionOpts.mode && ![RETENTION_MODES.COMPLIANCE, RETENTION_MODES.GOVERNANCE].includes(retentionOpts.mode)) {
        throw new errors.InvalidArgumentError(`Invalid object retention mode: ${retentionOpts.mode}`);
      }
      if (retentionOpts.retainUntilDate && !isString(retentionOpts.retainUntilDate)) {
        throw new errors.InvalidArgumentError(`Invalid value for retainUntilDate: ${retentionOpts.retainUntilDate}`);
      }
      if (retentionOpts.versionId && !isString(retentionOpts.versionId)) {
        throw new errors.InvalidArgumentError(`Invalid value for versionId: ${retentionOpts.versionId}`);
      }
    }
    const method = 'PUT';
    let query = 'retention';
    const headers = {};
    if (retentionOpts.governanceBypass) {
      headers['X-Amz-Bypass-Governance-Retention'] = true;
    }
    const builder = new xml2js.Builder({
      rootName: 'Retention',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const params = {};
    if (retentionOpts.mode) {
      params.Mode = retentionOpts.mode;
    }
    if (retentionOpts.retainUntilDate) {
      params.RetainUntilDate = retentionOpts.retainUntilDate;
    }
    if (retentionOpts.versionId) {
      query += `&versionId=${retentionOpts.versionId}`;
    }
    const payload = builder.buildObject(params);
    headers['Content-MD5'] = toMd5(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      objectName,
      query,
      headers
    }, payload, [200, 204]);
  }
  async getObjectLockConfig(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'object-lock';
    const httpRes = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const xmlResult = await readAsString(httpRes);
    return xmlParsers.parseObjectLockConfig(xmlResult);
  }
  async setObjectLockConfig(bucketName, lockConfigOpts) {
    const retentionModes = [RETENTION_MODES.COMPLIANCE, RETENTION_MODES.GOVERNANCE];
    const validUnits = [RETENTION_VALIDITY_UNITS.DAYS, RETENTION_VALIDITY_UNITS.YEARS];
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (lockConfigOpts.mode && !retentionModes.includes(lockConfigOpts.mode)) {
      throw new TypeError(`lockConfigOpts.mode should be one of ${retentionModes}`);
    }
    if (lockConfigOpts.unit && !validUnits.includes(lockConfigOpts.unit)) {
      throw new TypeError(`lockConfigOpts.unit should be one of ${validUnits}`);
    }
    if (lockConfigOpts.validity && !isNumber(lockConfigOpts.validity)) {
      throw new TypeError(`lockConfigOpts.validity should be a number`);
    }
    const method = 'PUT';
    const query = 'object-lock';
    const config = {
      ObjectLockEnabled: 'Enabled'
    };
    const configKeys = Object.keys(lockConfigOpts);
    const isAllKeysSet = ['unit', 'mode', 'validity'].every(lck => configKeys.includes(lck));
    // Check if keys are present and all keys are present.
    if (configKeys.length > 0) {
      if (!isAllKeysSet) {
        throw new TypeError(`lockConfigOpts.mode,lockConfigOpts.unit,lockConfigOpts.validity all the properties should be specified.`);
      } else {
        config.Rule = {
          DefaultRetention: {}
        };
        if (lockConfigOpts.mode) {
          config.Rule.DefaultRetention.Mode = lockConfigOpts.mode;
        }
        if (lockConfigOpts.unit === RETENTION_VALIDITY_UNITS.DAYS) {
          config.Rule.DefaultRetention.Days = lockConfigOpts.validity;
        } else if (lockConfigOpts.unit === RETENTION_VALIDITY_UNITS.YEARS) {
          config.Rule.DefaultRetention.Years = lockConfigOpts.validity;
        }
      }
    }
    const builder = new xml2js.Builder({
      rootName: 'ObjectLockConfiguration',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(config);
    const headers = {};
    headers['Content-MD5'] = toMd5(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query,
      headers
    }, payload);
  }
  async getBucketVersioning(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'versioning';
    const httpRes = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const xmlResult = await readAsString(httpRes);
    return await xmlParsers.parseBucketVersioningConfig(xmlResult);
  }
  async setBucketVersioning(bucketName, versionConfig) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!Object.keys(versionConfig).length) {
      throw new errors.InvalidArgumentError('versionConfig should be of type "object"');
    }
    const method = 'PUT';
    const query = 'versioning';
    const builder = new xml2js.Builder({
      rootName: 'VersioningConfiguration',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(versionConfig);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query
    }, payload);
  }
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJjcnlwdG8iLCJmcyIsImh0dHAiLCJodHRwcyIsInBhdGgiLCJzdHJlYW0iLCJhc3luYyIsIkJsb2NrU3RyZWFtMiIsImlzQnJvd3NlciIsIl8iLCJxcyIsInhtbDJqcyIsIkNyZWRlbnRpYWxQcm92aWRlciIsImVycm9ycyIsIkRFRkFVTFRfUkVHSU9OIiwiTEVHQUxfSE9MRF9TVEFUVVMiLCJSRVRFTlRJT05fTU9ERVMiLCJSRVRFTlRJT05fVkFMSURJVFlfVU5JVFMiLCJzaWduVjQiLCJmc3AiLCJzdHJlYW1Qcm9taXNlIiwiRXh0ZW5zaW9ucyIsImV4dHJhY3RNZXRhZGF0YSIsImdldENvbnRlbnRMZW5ndGgiLCJnZXRWZXJzaW9uSWQiLCJoYXNoQmluYXJ5IiwiaW5zZXJ0Q29udGVudFR5cGUiLCJpc0FtYXpvbkVuZHBvaW50IiwiaXNCb29sZWFuIiwiaXNEZWZpbmVkIiwiaXNFbXB0eSIsImlzTnVtYmVyIiwiaXNPYmplY3QiLCJpc1JlYWRhYmxlU3RyZWFtIiwiaXNTdHJpbmciLCJpc1ZhbGlkQnVja2V0TmFtZSIsImlzVmFsaWRFbmRwb2ludCIsImlzVmFsaWRPYmplY3ROYW1lIiwiaXNWYWxpZFBvcnQiLCJpc1ZhbGlkUHJlZml4IiwiaXNWaXJ0dWFsSG9zdFN0eWxlIiwibWFrZURhdGVMb25nIiwicHJlcGVuZFhBTVpNZXRhIiwicmVhZGFibGVTdHJlYW0iLCJzYW5pdGl6ZUVUYWciLCJ0b01kNSIsInRvU2hhMjU2IiwidXJpRXNjYXBlIiwidXJpUmVzb3VyY2VFc2NhcGUiLCJqb2luSG9zdFBvcnQiLCJyZXF1ZXN0IiwiZHJhaW5SZXNwb25zZSIsInJlYWRBc0J1ZmZlciIsInJlYWRBc1N0cmluZyIsImdldFMzRW5kcG9pbnQiLCJ4bWxQYXJzZXJzIiwicGFyc2VDb21wbGV0ZU11bHRpcGFydCIsInBhcnNlSW5pdGlhdGVNdWx0aXBhcnQiLCJwYXJzZU9iamVjdExlZ2FsSG9sZENvbmZpZyIsInhtbCIsIkJ1aWxkZXIiLCJyZW5kZXJPcHRzIiwicHJldHR5IiwiaGVhZGxlc3MiLCJQYWNrYWdlIiwidmVyc2lvbiIsInJlcXVlc3RPcHRpb25Qcm9wZXJ0aWVzIiwiVHlwZWRDbGllbnQiLCJwYXJ0U2l6ZSIsIm1heGltdW1QYXJ0U2l6ZSIsIm1heE9iamVjdFNpemUiLCJjb25zdHJ1Y3RvciIsInBhcmFtcyIsInNlY3VyZSIsInVuZGVmaW5lZCIsIkVycm9yIiwidXNlU1NMIiwicG9ydCIsImVuZFBvaW50IiwiSW52YWxpZEVuZHBvaW50RXJyb3IiLCJJbnZhbGlkQXJndW1lbnRFcnJvciIsInJlZ2lvbiIsImhvc3QiLCJ0b0xvd2VyQ2FzZSIsInByb3RvY29sIiwidHJhbnNwb3J0IiwidHJhbnNwb3J0QWdlbnQiLCJnbG9iYWxBZ2VudCIsImxpYnJhcnlDb21tZW50cyIsInByb2Nlc3MiLCJwbGF0Zm9ybSIsImFyY2giLCJsaWJyYXJ5QWdlbnQiLCJ1c2VyQWdlbnQiLCJwYXRoU3R5bGUiLCJhY2Nlc3NLZXkiLCJzZWNyZXRLZXkiLCJzZXNzaW9uVG9rZW4iLCJhbm9ueW1vdXMiLCJjcmVkZW50aWFsc1Byb3ZpZGVyIiwicmVnaW9uTWFwIiwib3ZlclJpZGVQYXJ0U2l6ZSIsImVuYWJsZVNIQTI1NiIsInMzQWNjZWxlcmF0ZUVuZHBvaW50IiwicmVxT3B0aW9ucyIsImNsaWVudEV4dGVuc2lvbnMiLCJleHRlbnNpb25zIiwic2V0UzNUcmFuc2ZlckFjY2VsZXJhdGUiLCJzZXRSZXF1ZXN0T3B0aW9ucyIsIm9wdGlvbnMiLCJUeXBlRXJyb3IiLCJwaWNrIiwiZ2V0QWNjZWxlcmF0ZUVuZFBvaW50SWZTZXQiLCJidWNrZXROYW1lIiwib2JqZWN0TmFtZSIsImluY2x1ZGVzIiwiZ2V0UmVxdWVzdE9wdGlvbnMiLCJvcHRzIiwibWV0aG9kIiwiaGVhZGVycyIsInF1ZXJ5IiwiYWdlbnQiLCJ2aXJ0dWFsSG9zdFN0eWxlIiwiYWNjZWxlcmF0ZUVuZFBvaW50IiwiayIsInYiLCJPYmplY3QiLCJlbnRyaWVzIiwiYXNzaWduIiwibWFwVmFsdWVzIiwicGlja0J5IiwidG9TdHJpbmciLCJzZXRDcmVkZW50aWFsc1Byb3ZpZGVyIiwiY2hlY2tBbmRSZWZyZXNoQ3JlZHMiLCJjcmVkZW50aWFsc0NvbmYiLCJnZXRDcmVkZW50aWFscyIsImdldEFjY2Vzc0tleSIsImdldFNlY3JldEtleSIsImdldFNlc3Npb25Ub2tlbiIsImUiLCJjYXVzZSIsImxvZ0hUVFAiLCJyZXNwb25zZSIsImVyciIsImxvZ1N0cmVhbSIsImxvZ0hlYWRlcnMiLCJmb3JFYWNoIiwicmVkYWN0b3IiLCJSZWdFeHAiLCJyZXBsYWNlIiwid3JpdGUiLCJzdGF0dXNDb2RlIiwiZXJySlNPTiIsIkpTT04iLCJzdHJpbmdpZnkiLCJ0cmFjZU9uIiwic3Rkb3V0IiwidHJhY2VPZmYiLCJtYWtlUmVxdWVzdEFzeW5jIiwicGF5bG9hZCIsImV4cGVjdGVkQ29kZXMiLCJsZW5ndGgiLCJzaGEyNTZzdW0iLCJtYWtlUmVxdWVzdFN0cmVhbUFzeW5jIiwibWFrZVJlcXVlc3RBc3luY09taXQiLCJzdGF0dXNDb2RlcyIsInJlcyIsImJvZHkiLCJCdWZmZXIiLCJpc0J1ZmZlciIsImdldEJ1Y2tldFJlZ2lvbkFzeW5jIiwiZGF0ZSIsIkRhdGUiLCJhdXRob3JpemF0aW9uIiwicGFyc2VSZXNwb25zZUVycm9yIiwiSW52YWxpZEJ1Y2tldE5hbWVFcnJvciIsImNhY2hlZCIsImV4dHJhY3RSZWdpb25Bc3luYyIsInBhcnNlQnVja2V0UmVnaW9uIiwibmFtZSIsIlJlZ2lvbiIsIm1ha2VSZXF1ZXN0IiwicmV0dXJuUmVzcG9uc2UiLCJjYiIsInByb20iLCJ0aGVuIiwicmVzdWx0IiwibWFrZVJlcXVlc3RTdHJlYW0iLCJleGVjdXRvciIsImdldEJ1Y2tldFJlZ2lvbiIsIm1ha2VCdWNrZXQiLCJtYWtlT3B0cyIsImJ1aWxkT2JqZWN0IiwiQ3JlYXRlQnVja2V0Q29uZmlndXJhdGlvbiIsIiQiLCJ4bWxucyIsIkxvY2F0aW9uQ29uc3RyYWludCIsIk9iamVjdExvY2tpbmciLCJmaW5hbFJlZ2lvbiIsInJlcXVlc3RPcHQiLCJTM0Vycm9yIiwiZXJyQ29kZSIsImNvZGUiLCJlcnJSZWdpb24iLCJidWNrZXRFeGlzdHMiLCJyZW1vdmVCdWNrZXQiLCJnZXRPYmplY3QiLCJnZXRPcHRzIiwiSW52YWxpZE9iamVjdE5hbWVFcnJvciIsImdldFBhcnRpYWxPYmplY3QiLCJvZmZzZXQiLCJyYW5nZSIsImV4cGVjdGVkU3RhdHVzQ29kZXMiLCJwdXNoIiwiZkdldE9iamVjdCIsImZpbGVQYXRoIiwiZG93bmxvYWRUb1RtcEZpbGUiLCJwYXJ0RmlsZVN0cmVhbSIsIm9ialN0YXQiLCJzdGF0T2JqZWN0IiwicGFydEZpbGUiLCJldGFnIiwibWtkaXIiLCJkaXJuYW1lIiwicmVjdXJzaXZlIiwic3RhdHMiLCJzdGF0Iiwic2l6ZSIsImNyZWF0ZVdyaXRlU3RyZWFtIiwiZmxhZ3MiLCJkb3dubG9hZFN0cmVhbSIsInBpcGVsaW5lIiwicmVuYW1lIiwic3RhdE9wdHMiLCJwYXJzZUludCIsIm1ldGFEYXRhIiwibGFzdE1vZGlmaWVkIiwidmVyc2lvbklkIiwicmVtb3ZlT2JqZWN0IiwicmVtb3ZlT3B0cyIsImdvdmVybmFuY2VCeXBhc3MiLCJmb3JjZURlbGV0ZSIsInF1ZXJ5UGFyYW1zIiwibGlzdEluY29tcGxldGVVcGxvYWRzIiwiYnVja2V0IiwicHJlZml4IiwiSW52YWxpZFByZWZpeEVycm9yIiwiZGVsaW1pdGVyIiwia2V5TWFya2VyIiwidXBsb2FkSWRNYXJrZXIiLCJ1cGxvYWRzIiwiZW5kZWQiLCJyZWFkU3RyZWFtIiwiUmVhZGFibGUiLCJvYmplY3RNb2RlIiwiX3JlYWQiLCJzaGlmdCIsImxpc3RJbmNvbXBsZXRlVXBsb2Fkc1F1ZXJ5IiwicHJlZml4ZXMiLCJlYWNoU2VyaWVzIiwidXBsb2FkIiwibGlzdFBhcnRzIiwia2V5IiwidXBsb2FkSWQiLCJwYXJ0cyIsInJlZHVjZSIsImFjYyIsIml0ZW0iLCJlbWl0IiwiaXNUcnVuY2F0ZWQiLCJuZXh0S2V5TWFya2VyIiwibmV4dFVwbG9hZElkTWFya2VyIiwicXVlcmllcyIsIm1heFVwbG9hZHMiLCJzb3J0IiwidW5zaGlmdCIsImpvaW4iLCJwYXJzZUxpc3RNdWx0aXBhcnQiLCJpbml0aWF0ZU5ld011bHRpcGFydFVwbG9hZCIsImFib3J0TXVsdGlwYXJ0VXBsb2FkIiwicmVxdWVzdE9wdGlvbnMiLCJmaW5kVXBsb2FkSWQiLCJfbGF0ZXN0VXBsb2FkIiwibGF0ZXN0VXBsb2FkIiwiaW5pdGlhdGVkIiwiZ2V0VGltZSIsImNvbXBsZXRlTXVsdGlwYXJ0VXBsb2FkIiwiZXRhZ3MiLCJidWlsZGVyIiwiQ29tcGxldGVNdWx0aXBhcnRVcGxvYWQiLCJQYXJ0IiwibWFwIiwiUGFydE51bWJlciIsInBhcnQiLCJFVGFnIiwiZXJyTWVzc2FnZSIsIm1hcmtlciIsImxpc3RQYXJ0c1F1ZXJ5IiwicGFyc2VMaXN0UGFydHMiLCJsaXN0QnVja2V0cyIsImh0dHBSZXMiLCJ4bWxSZXN1bHQiLCJwYXJzZUxpc3RCdWNrZXQiLCJjYWxjdWxhdGVQYXJ0U2l6ZSIsImZQdXRPYmplY3QiLCJsc3RhdCIsInB1dE9iamVjdCIsImNyZWF0ZVJlYWRTdHJlYW0iLCJzdGF0U2l6ZSIsImJ1ZiIsImZyb20iLCJ1cGxvYWRCdWZmZXIiLCJ1cGxvYWRTdHJlYW0iLCJtZDVzdW0iLCJvbGRQYXJ0cyIsImVUYWdzIiwicHJldmlvdXNVcGxvYWRJZCIsIm9sZFRhZ3MiLCJjaHVua2llciIsInplcm9QYWRkaW5nIiwibyIsIlByb21pc2UiLCJhbGwiLCJyZXNvbHZlIiwicmVqZWN0IiwicGlwZSIsIm9uIiwicGFydE51bWJlciIsImNodW5rIiwibWQ1IiwiY3JlYXRlSGFzaCIsInVwZGF0ZSIsImRpZ2VzdCIsIm9sZFBhcnQiLCJyZW1vdmVCdWNrZXRSZXBsaWNhdGlvbiIsInNldEJ1Y2tldFJlcGxpY2F0aW9uIiwicmVwbGljYXRpb25Db25maWciLCJyb2xlIiwicnVsZXMiLCJyZXBsaWNhdGlvblBhcmFtc0NvbmZpZyIsIlJlcGxpY2F0aW9uQ29uZmlndXJhdGlvbiIsIlJvbGUiLCJSdWxlIiwiZ2V0QnVja2V0UmVwbGljYXRpb24iLCJwYXJzZVJlcGxpY2F0aW9uQ29uZmlnIiwiZ2V0T2JqZWN0TGVnYWxIb2xkIiwia2V5cyIsInN0clJlcyIsInNldE9iamVjdExlZ2FsSG9sZCIsInNldE9wdHMiLCJzdGF0dXMiLCJFTkFCTEVEIiwiRElTQUJMRUQiLCJjb25maWciLCJTdGF0dXMiLCJyb290TmFtZSIsImdldEJ1Y2tldFRhZ2dpbmciLCJwYXJzZVRhZ2dpbmciLCJnZXRPYmplY3RUYWdnaW5nIiwic2V0QnVja2V0UG9saWN5IiwicG9saWN5IiwiSW52YWxpZEJ1Y2tldFBvbGljeUVycm9yIiwiZ2V0QnVja2V0UG9saWN5IiwicHV0T2JqZWN0UmV0ZW50aW9uIiwicmV0ZW50aW9uT3B0cyIsIm1vZGUiLCJDT01QTElBTkNFIiwiR09WRVJOQU5DRSIsInJldGFpblVudGlsRGF0ZSIsIk1vZGUiLCJSZXRhaW5VbnRpbERhdGUiLCJnZXRPYmplY3RMb2NrQ29uZmlnIiwicGFyc2VPYmplY3RMb2NrQ29uZmlnIiwic2V0T2JqZWN0TG9ja0NvbmZpZyIsImxvY2tDb25maWdPcHRzIiwicmV0ZW50aW9uTW9kZXMiLCJ2YWxpZFVuaXRzIiwiREFZUyIsIllFQVJTIiwidW5pdCIsInZhbGlkaXR5IiwiT2JqZWN0TG9ja0VuYWJsZWQiLCJjb25maWdLZXlzIiwiaXNBbGxLZXlzU2V0IiwiZXZlcnkiLCJsY2siLCJEZWZhdWx0UmV0ZW50aW9uIiwiRGF5cyIsIlllYXJzIiwiZ2V0QnVja2V0VmVyc2lvbmluZyIsInBhcnNlQnVja2V0VmVyc2lvbmluZ0NvbmZpZyIsInNldEJ1Y2tldFZlcnNpb25pbmciLCJ2ZXJzaW9uQ29uZmlnIl0sInNvdXJjZXMiOlsiY2xpZW50LnRzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNyeXB0byBmcm9tICdub2RlOmNyeXB0bydcbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnXG5pbXBvcnQgKiBhcyBodHRwIGZyb20gJ25vZGU6aHR0cCdcbmltcG9ydCAqIGFzIGh0dHBzIGZyb20gJ25vZGU6aHR0cHMnXG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ25vZGU6cGF0aCdcbmltcG9ydCAqIGFzIHN0cmVhbSBmcm9tICdub2RlOnN0cmVhbSdcblxuaW1wb3J0ICogYXMgYXN5bmMgZnJvbSAnYXN5bmMnXG5pbXBvcnQgQmxvY2tTdHJlYW0yIGZyb20gJ2Jsb2NrLXN0cmVhbTInXG5pbXBvcnQgeyBpc0Jyb3dzZXIgfSBmcm9tICdicm93c2VyLW9yLW5vZGUnXG5pbXBvcnQgXyBmcm9tICdsb2Rhc2gnXG5pbXBvcnQgKiBhcyBxcyBmcm9tICdxdWVyeS1zdHJpbmcnXG5pbXBvcnQgeG1sMmpzIGZyb20gJ3htbDJqcydcblxuaW1wb3J0IHsgQ3JlZGVudGlhbFByb3ZpZGVyIH0gZnJvbSAnLi4vQ3JlZGVudGlhbFByb3ZpZGVyLnRzJ1xuaW1wb3J0ICogYXMgZXJyb3JzIGZyb20gJy4uL2Vycm9ycy50cydcbmltcG9ydCB7IERFRkFVTFRfUkVHSU9OLCBMRUdBTF9IT0xEX1NUQVRVUywgUkVURU5USU9OX01PREVTLCBSRVRFTlRJT05fVkFMSURJVFlfVU5JVFMgfSBmcm9tICcuLi9oZWxwZXJzLnRzJ1xuaW1wb3J0IHsgc2lnblY0IH0gZnJvbSAnLi4vc2lnbmluZy50cydcbmltcG9ydCB7IGZzcCwgc3RyZWFtUHJvbWlzZSB9IGZyb20gJy4vYXN5bmMudHMnXG5pbXBvcnQgeyBFeHRlbnNpb25zIH0gZnJvbSAnLi9leHRlbnNpb25zLnRzJ1xuaW1wb3J0IHtcbiAgZXh0cmFjdE1ldGFkYXRhLFxuICBnZXRDb250ZW50TGVuZ3RoLFxuICBnZXRWZXJzaW9uSWQsXG4gIGhhc2hCaW5hcnksXG4gIGluc2VydENvbnRlbnRUeXBlLFxuICBpc0FtYXpvbkVuZHBvaW50LFxuICBpc0Jvb2xlYW4sXG4gIGlzRGVmaW5lZCxcbiAgaXNFbXB0eSxcbiAgaXNOdW1iZXIsXG4gIGlzT2JqZWN0LFxuICBpc1JlYWRhYmxlU3RyZWFtLFxuICBpc1N0cmluZyxcbiAgaXNWYWxpZEJ1Y2tldE5hbWUsXG4gIGlzVmFsaWRFbmRwb2ludCxcbiAgaXNWYWxpZE9iamVjdE5hbWUsXG4gIGlzVmFsaWRQb3J0LFxuICBpc1ZhbGlkUHJlZml4LFxuICBpc1ZpcnR1YWxIb3N0U3R5bGUsXG4gIG1ha2VEYXRlTG9uZyxcbiAgcHJlcGVuZFhBTVpNZXRhLFxuICByZWFkYWJsZVN0cmVhbSxcbiAgc2FuaXRpemVFVGFnLFxuICB0b01kNSxcbiAgdG9TaGEyNTYsXG4gIHVyaUVzY2FwZSxcbiAgdXJpUmVzb3VyY2VFc2NhcGUsXG59IGZyb20gJy4vaGVscGVyLnRzJ1xuaW1wb3J0IHsgam9pbkhvc3RQb3J0IH0gZnJvbSAnLi9qb2luLWhvc3QtcG9ydC50cydcbmltcG9ydCB7IHJlcXVlc3QgfSBmcm9tICcuL3JlcXVlc3QudHMnXG5pbXBvcnQgeyBkcmFpblJlc3BvbnNlLCByZWFkQXNCdWZmZXIsIHJlYWRBc1N0cmluZyB9IGZyb20gJy4vcmVzcG9uc2UudHMnXG5pbXBvcnQgdHlwZSB7IFJlZ2lvbiB9IGZyb20gJy4vczMtZW5kcG9pbnRzLnRzJ1xuaW1wb3J0IHsgZ2V0UzNFbmRwb2ludCB9IGZyb20gJy4vczMtZW5kcG9pbnRzLnRzJ1xuaW1wb3J0IHR5cGUge1xuICBCaW5hcnksXG4gIEJ1Y2tldEl0ZW1Gcm9tTGlzdCxcbiAgQnVja2V0SXRlbVN0YXQsXG4gIEJ1Y2tldFN0cmVhbSxcbiAgQnVja2V0VmVyc2lvbmluZ0NvbmZpZ3VyYXRpb24sXG4gIEdldE9iamVjdExlZ2FsSG9sZE9wdGlvbnMsXG4gIEluY29tcGxldGVVcGxvYWRlZEJ1Y2tldEl0ZW0sXG4gIElSZXF1ZXN0LFxuICBJdGVtQnVja2V0TWV0YWRhdGEsXG4gIE9iamVjdExvY2tDb25maWdQYXJhbSxcbiAgT2JqZWN0TG9ja0luZm8sXG4gIE9iamVjdE1ldGFEYXRhLFxuICBQdXRPYmplY3RMZWdhbEhvbGRPcHRpb25zLFxuICBSZXBsaWNhdGlvbkNvbmZpZyxcbiAgUmVwbGljYXRpb25Db25maWdPcHRzLFxuICBSZXF1ZXN0SGVhZGVycyxcbiAgUmVzcG9uc2VIZWFkZXIsXG4gIFJlc3VsdENhbGxiYWNrLFxuICBSZXRlbnRpb24sXG4gIFN0YXRPYmplY3RPcHRzLFxuICBUYWcsXG4gIFRyYW5zcG9ydCxcbiAgVXBsb2FkZWRPYmplY3RJbmZvLFxuICBWZXJzaW9uSWRlbnRpZmljYXRvcixcbn0gZnJvbSAnLi90eXBlLnRzJ1xuaW1wb3J0IHR5cGUgeyBMaXN0TXVsdGlwYXJ0UmVzdWx0LCBVcGxvYWRlZFBhcnQgfSBmcm9tICcuL3htbC1wYXJzZXIudHMnXG5pbXBvcnQgKiBhcyB4bWxQYXJzZXJzIGZyb20gJy4veG1sLXBhcnNlci50cydcbmltcG9ydCB7IHBhcnNlQ29tcGxldGVNdWx0aXBhcnQsIHBhcnNlSW5pdGlhdGVNdWx0aXBhcnQsIHBhcnNlT2JqZWN0TGVnYWxIb2xkQ29uZmlnIH0gZnJvbSAnLi94bWwtcGFyc2VyLnRzJ1xuXG5jb25zdCB4bWwgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoeyByZW5kZXJPcHRzOiB7IHByZXR0eTogZmFsc2UgfSwgaGVhZGxlc3M6IHRydWUgfSlcblxuLy8gd2lsbCBiZSByZXBsYWNlZCBieSBidW5kbGVyLlxuY29uc3QgUGFja2FnZSA9IHsgdmVyc2lvbjogcHJvY2Vzcy5lbnYuTUlOSU9fSlNfUEFDS0FHRV9WRVJTSU9OIHx8ICdkZXZlbG9wbWVudCcgfVxuXG5jb25zdCByZXF1ZXN0T3B0aW9uUHJvcGVydGllcyA9IFtcbiAgJ2FnZW50JyxcbiAgJ2NhJyxcbiAgJ2NlcnQnLFxuICAnY2lwaGVycycsXG4gICdjbGllbnRDZXJ0RW5naW5lJyxcbiAgJ2NybCcsXG4gICdkaHBhcmFtJyxcbiAgJ2VjZGhDdXJ2ZScsXG4gICdmYW1pbHknLFxuICAnaG9ub3JDaXBoZXJPcmRlcicsXG4gICdrZXknLFxuICAncGFzc3BocmFzZScsXG4gICdwZngnLFxuICAncmVqZWN0VW5hdXRob3JpemVkJyxcbiAgJ3NlY3VyZU9wdGlvbnMnLFxuICAnc2VjdXJlUHJvdG9jb2wnLFxuICAnc2VydmVybmFtZScsXG4gICdzZXNzaW9uSWRDb250ZXh0Jyxcbl0gYXMgY29uc3RcblxuZXhwb3J0IGludGVyZmFjZSBDbGllbnRPcHRpb25zIHtcbiAgZW5kUG9pbnQ6IHN0cmluZ1xuICBhY2Nlc3NLZXk6IHN0cmluZ1xuICBzZWNyZXRLZXk6IHN0cmluZ1xuICB1c2VTU0w/OiBib29sZWFuXG4gIHBvcnQ/OiBudW1iZXJcbiAgcmVnaW9uPzogUmVnaW9uXG4gIHRyYW5zcG9ydD86IFRyYW5zcG9ydFxuICBzZXNzaW9uVG9rZW4/OiBzdHJpbmdcbiAgcGFydFNpemU/OiBudW1iZXJcbiAgcGF0aFN0eWxlPzogYm9vbGVhblxuICBjcmVkZW50aWFsc1Byb3ZpZGVyPzogQ3JlZGVudGlhbFByb3ZpZGVyXG4gIHMzQWNjZWxlcmF0ZUVuZHBvaW50Pzogc3RyaW5nXG4gIHRyYW5zcG9ydEFnZW50PzogaHR0cC5BZ2VudFxufVxuXG5leHBvcnQgdHlwZSBSZXF1ZXN0T3B0aW9uID0gUGFydGlhbDxJUmVxdWVzdD4gJiB7XG4gIG1ldGhvZDogc3RyaW5nXG4gIGJ1Y2tldE5hbWU/OiBzdHJpbmdcbiAgb2JqZWN0TmFtZT86IHN0cmluZ1xuICBxdWVyeT86IHN0cmluZ1xuICBwYXRoU3R5bGU/OiBib29sZWFuXG59XG5cbmV4cG9ydCB0eXBlIE5vUmVzdWx0Q2FsbGJhY2sgPSAoZXJyb3I6IHVua25vd24pID0+IHZvaWRcblxuZXhwb3J0IGludGVyZmFjZSBNYWtlQnVja2V0T3B0IHtcbiAgT2JqZWN0TG9ja2luZz86IGJvb2xlYW5cbn1cblxuZXhwb3J0IGludGVyZmFjZSBSZW1vdmVPcHRpb25zIHtcbiAgdmVyc2lvbklkPzogc3RyaW5nXG4gIGdvdmVybmFuY2VCeXBhc3M/OiBib29sZWFuXG4gIGZvcmNlRGVsZXRlPzogYm9vbGVhblxufVxuXG50eXBlIFBhcnQgPSB7XG4gIHBhcnQ6IG51bWJlclxuICBldGFnOiBzdHJpbmdcbn1cblxuZXhwb3J0IGNsYXNzIFR5cGVkQ2xpZW50IHtcbiAgcHJvdGVjdGVkIHRyYW5zcG9ydDogVHJhbnNwb3J0XG4gIHByb3RlY3RlZCBob3N0OiBzdHJpbmdcbiAgcHJvdGVjdGVkIHBvcnQ6IG51bWJlclxuICBwcm90ZWN0ZWQgcHJvdG9jb2w6IHN0cmluZ1xuICBwcm90ZWN0ZWQgYWNjZXNzS2V5OiBzdHJpbmdcbiAgcHJvdGVjdGVkIHNlY3JldEtleTogc3RyaW5nXG4gIHByb3RlY3RlZCBzZXNzaW9uVG9rZW4/OiBzdHJpbmdcbiAgcHJvdGVjdGVkIHVzZXJBZ2VudDogc3RyaW5nXG4gIHByb3RlY3RlZCBhbm9ueW1vdXM6IGJvb2xlYW5cbiAgcHJvdGVjdGVkIHBhdGhTdHlsZTogYm9vbGVhblxuICBwcm90ZWN0ZWQgcmVnaW9uTWFwOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+XG4gIHB1YmxpYyByZWdpb24/OiBzdHJpbmdcbiAgcHJvdGVjdGVkIGNyZWRlbnRpYWxzUHJvdmlkZXI/OiBDcmVkZW50aWFsUHJvdmlkZXJcbiAgcGFydFNpemU6IG51bWJlciA9IDY0ICogMTAyNCAqIDEwMjRcbiAgcHJvdGVjdGVkIG92ZXJSaWRlUGFydFNpemU/OiBib29sZWFuXG5cbiAgcHJvdGVjdGVkIG1heGltdW1QYXJ0U2l6ZSA9IDUgKiAxMDI0ICogMTAyNCAqIDEwMjRcbiAgcHJvdGVjdGVkIG1heE9iamVjdFNpemUgPSA1ICogMTAyNCAqIDEwMjQgKiAxMDI0ICogMTAyNFxuICBwdWJsaWMgZW5hYmxlU0hBMjU2OiBib29sZWFuXG4gIHByb3RlY3RlZCBzM0FjY2VsZXJhdGVFbmRwb2ludD86IHN0cmluZ1xuICBwcm90ZWN0ZWQgcmVxT3B0aW9uczogUmVjb3JkPHN0cmluZywgdW5rbm93bj5cblxuICBwcm90ZWN0ZWQgdHJhbnNwb3J0QWdlbnQ6IGh0dHAuQWdlbnRcbiAgcHJpdmF0ZSByZWFkb25seSBjbGllbnRFeHRlbnNpb25zOiBFeHRlbnNpb25zXG5cbiAgY29uc3RydWN0b3IocGFyYW1zOiBDbGllbnRPcHRpb25zKSB7XG4gICAgLy8gQHRzLWV4cGVjdC1lcnJvciBkZXByZWNhdGVkIHByb3BlcnR5XG4gICAgaWYgKHBhcmFtcy5zZWN1cmUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdcInNlY3VyZVwiIG9wdGlvbiBkZXByZWNhdGVkLCBcInVzZVNTTFwiIHNob3VsZCBiZSB1c2VkIGluc3RlYWQnKVxuICAgIH1cbiAgICAvLyBEZWZhdWx0IHZhbHVlcyBpZiBub3Qgc3BlY2lmaWVkLlxuICAgIGlmIChwYXJhbXMudXNlU1NMID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHBhcmFtcy51c2VTU0wgPSB0cnVlXG4gICAgfVxuICAgIGlmICghcGFyYW1zLnBvcnQpIHtcbiAgICAgIHBhcmFtcy5wb3J0ID0gMFxuICAgIH1cbiAgICAvLyBWYWxpZGF0ZSBpbnB1dCBwYXJhbXMuXG4gICAgaWYgKCFpc1ZhbGlkRW5kcG9pbnQocGFyYW1zLmVuZFBvaW50KSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkRW5kcG9pbnRFcnJvcihgSW52YWxpZCBlbmRQb2ludCA6ICR7cGFyYW1zLmVuZFBvaW50fWApXG4gICAgfVxuICAgIGlmICghaXNWYWxpZFBvcnQocGFyYW1zLnBvcnQpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBJbnZhbGlkIHBvcnQgOiAke3BhcmFtcy5wb3J0fWApXG4gICAgfVxuICAgIGlmICghaXNCb29sZWFuKHBhcmFtcy51c2VTU0wpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKFxuICAgICAgICBgSW52YWxpZCB1c2VTU0wgZmxhZyB0eXBlIDogJHtwYXJhbXMudXNlU1NMfSwgZXhwZWN0ZWQgdG8gYmUgb2YgdHlwZSBcImJvb2xlYW5cImAsXG4gICAgICApXG4gICAgfVxuXG4gICAgLy8gVmFsaWRhdGUgcmVnaW9uIG9ubHkgaWYgaXRzIHNldC5cbiAgICBpZiAocGFyYW1zLnJlZ2lvbikge1xuICAgICAgaWYgKCFpc1N0cmluZyhwYXJhbXMucmVnaW9uKSkge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBJbnZhbGlkIHJlZ2lvbiA6ICR7cGFyYW1zLnJlZ2lvbn1gKVxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IGhvc3QgPSBwYXJhbXMuZW5kUG9pbnQudG9Mb3dlckNhc2UoKVxuICAgIGxldCBwb3J0ID0gcGFyYW1zLnBvcnRcbiAgICBsZXQgcHJvdG9jb2w6IHN0cmluZ1xuICAgIGxldCB0cmFuc3BvcnRcbiAgICBsZXQgdHJhbnNwb3J0QWdlbnQ6IGh0dHAuQWdlbnRcbiAgICAvLyBWYWxpZGF0ZSBpZiBjb25maWd1cmF0aW9uIGlzIG5vdCB1c2luZyBTU0xcbiAgICAvLyBmb3IgY29uc3RydWN0aW5nIHJlbGV2YW50IGVuZHBvaW50cy5cbiAgICBpZiAocGFyYW1zLnVzZVNTTCkge1xuICAgICAgLy8gRGVmYXVsdHMgdG8gc2VjdXJlLlxuICAgICAgdHJhbnNwb3J0ID0gaHR0cHNcbiAgICAgIHByb3RvY29sID0gJ2h0dHBzOidcbiAgICAgIHBvcnQgPSBwb3J0IHx8IDQ0M1xuICAgICAgdHJhbnNwb3J0QWdlbnQgPSBodHRwcy5nbG9iYWxBZ2VudFxuICAgIH0gZWxzZSB7XG4gICAgICB0cmFuc3BvcnQgPSBodHRwXG4gICAgICBwcm90b2NvbCA9ICdodHRwOidcbiAgICAgIHBvcnQgPSBwb3J0IHx8IDgwXG4gICAgICB0cmFuc3BvcnRBZ2VudCA9IGh0dHAuZ2xvYmFsQWdlbnRcbiAgICB9XG5cbiAgICAvLyBpZiBjdXN0b20gdHJhbnNwb3J0IGlzIHNldCwgdXNlIGl0LlxuICAgIGlmIChwYXJhbXMudHJhbnNwb3J0KSB7XG4gICAgICBpZiAoIWlzT2JqZWN0KHBhcmFtcy50cmFuc3BvcnQpKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoXG4gICAgICAgICAgYEludmFsaWQgdHJhbnNwb3J0IHR5cGUgOiAke3BhcmFtcy50cmFuc3BvcnR9LCBleHBlY3RlZCB0byBiZSB0eXBlIFwib2JqZWN0XCJgLFxuICAgICAgICApXG4gICAgICB9XG4gICAgICB0cmFuc3BvcnQgPSBwYXJhbXMudHJhbnNwb3J0XG4gICAgfVxuXG4gICAgLy8gaWYgY3VzdG9tIHRyYW5zcG9ydCBhZ2VudCBpcyBzZXQsIHVzZSBpdC5cbiAgICBpZiAocGFyYW1zLnRyYW5zcG9ydEFnZW50KSB7XG4gICAgICBpZiAoIWlzT2JqZWN0KHBhcmFtcy50cmFuc3BvcnRBZ2VudCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihcbiAgICAgICAgICBgSW52YWxpZCB0cmFuc3BvcnRBZ2VudCB0eXBlOiAke3BhcmFtcy50cmFuc3BvcnRBZ2VudH0sIGV4cGVjdGVkIHRvIGJlIHR5cGUgXCJvYmplY3RcImAsXG4gICAgICAgIClcbiAgICAgIH1cblxuICAgICAgdHJhbnNwb3J0QWdlbnQgPSBwYXJhbXMudHJhbnNwb3J0QWdlbnRcbiAgICB9XG5cbiAgICAvLyBVc2VyIEFnZW50IHNob3VsZCBhbHdheXMgZm9sbG93aW5nIHRoZSBiZWxvdyBzdHlsZS5cbiAgICAvLyBQbGVhc2Ugb3BlbiBhbiBpc3N1ZSB0byBkaXNjdXNzIGFueSBuZXcgY2hhbmdlcyBoZXJlLlxuICAgIC8vXG4gICAgLy8gICAgICAgTWluSU8gKE9TOyBBUkNIKSBMSUIvVkVSIEFQUC9WRVJcbiAgICAvL1xuICAgIGNvbnN0IGxpYnJhcnlDb21tZW50cyA9IGAoJHtwcm9jZXNzLnBsYXRmb3JtfTsgJHtwcm9jZXNzLmFyY2h9KWBcbiAgICBjb25zdCBsaWJyYXJ5QWdlbnQgPSBgTWluSU8gJHtsaWJyYXJ5Q29tbWVudHN9IG1pbmlvLWpzLyR7UGFja2FnZS52ZXJzaW9ufWBcbiAgICAvLyBVc2VyIGFnZW50IGJsb2NrIGVuZHMuXG5cbiAgICB0aGlzLnRyYW5zcG9ydCA9IHRyYW5zcG9ydFxuICAgIHRoaXMudHJhbnNwb3J0QWdlbnQgPSB0cmFuc3BvcnRBZ2VudFxuICAgIHRoaXMuaG9zdCA9IGhvc3RcbiAgICB0aGlzLnBvcnQgPSBwb3J0XG4gICAgdGhpcy5wcm90b2NvbCA9IHByb3RvY29sXG4gICAgdGhpcy51c2VyQWdlbnQgPSBgJHtsaWJyYXJ5QWdlbnR9YFxuXG4gICAgLy8gRGVmYXVsdCBwYXRoIHN0eWxlIGlzIHRydWVcbiAgICBpZiAocGFyYW1zLnBhdGhTdHlsZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLnBhdGhTdHlsZSA9IHRydWVcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5wYXRoU3R5bGUgPSBwYXJhbXMucGF0aFN0eWxlXG4gICAgfVxuXG4gICAgdGhpcy5hY2Nlc3NLZXkgPSBwYXJhbXMuYWNjZXNzS2V5ID8/ICcnXG4gICAgdGhpcy5zZWNyZXRLZXkgPSBwYXJhbXMuc2VjcmV0S2V5ID8/ICcnXG4gICAgdGhpcy5zZXNzaW9uVG9rZW4gPSBwYXJhbXMuc2Vzc2lvblRva2VuXG4gICAgdGhpcy5hbm9ueW1vdXMgPSAhdGhpcy5hY2Nlc3NLZXkgfHwgIXRoaXMuc2VjcmV0S2V5XG5cbiAgICBpZiAocGFyYW1zLmNyZWRlbnRpYWxzUHJvdmlkZXIpIHtcbiAgICAgIHRoaXMuY3JlZGVudGlhbHNQcm92aWRlciA9IHBhcmFtcy5jcmVkZW50aWFsc1Byb3ZpZGVyXG4gICAgfVxuXG4gICAgdGhpcy5yZWdpb25NYXAgPSB7fVxuICAgIGlmIChwYXJhbXMucmVnaW9uKSB7XG4gICAgICB0aGlzLnJlZ2lvbiA9IHBhcmFtcy5yZWdpb25cbiAgICB9XG5cbiAgICBpZiAocGFyYW1zLnBhcnRTaXplKSB7XG4gICAgICB0aGlzLnBhcnRTaXplID0gcGFyYW1zLnBhcnRTaXplXG4gICAgICB0aGlzLm92ZXJSaWRlUGFydFNpemUgPSB0cnVlXG4gICAgfVxuICAgIGlmICh0aGlzLnBhcnRTaXplIDwgNSAqIDEwMjQgKiAxMDI0KSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBQYXJ0IHNpemUgc2hvdWxkIGJlIGdyZWF0ZXIgdGhhbiA1TUJgKVxuICAgIH1cbiAgICBpZiAodGhpcy5wYXJ0U2l6ZSA+IDUgKiAxMDI0ICogMTAyNCAqIDEwMjQpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYFBhcnQgc2l6ZSBzaG91bGQgYmUgbGVzcyB0aGFuIDVHQmApXG4gICAgfVxuXG4gICAgLy8gU0hBMjU2IGlzIGVuYWJsZWQgb25seSBmb3IgYXV0aGVudGljYXRlZCBodHRwIHJlcXVlc3RzLiBJZiB0aGUgcmVxdWVzdCBpcyBhdXRoZW50aWNhdGVkXG4gICAgLy8gYW5kIHRoZSBjb25uZWN0aW9uIGlzIGh0dHBzIHdlIHVzZSB4LWFtei1jb250ZW50LXNoYTI1Nj1VTlNJR05FRC1QQVlMT0FEXG4gICAgLy8gaGVhZGVyIGZvciBzaWduYXR1cmUgY2FsY3VsYXRpb24uXG4gICAgdGhpcy5lbmFibGVTSEEyNTYgPSAhdGhpcy5hbm9ueW1vdXMgJiYgIXBhcmFtcy51c2VTU0xcblxuICAgIHRoaXMuczNBY2NlbGVyYXRlRW5kcG9pbnQgPSBwYXJhbXMuczNBY2NlbGVyYXRlRW5kcG9pbnQgfHwgdW5kZWZpbmVkXG4gICAgdGhpcy5yZXFPcHRpb25zID0ge31cbiAgICB0aGlzLmNsaWVudEV4dGVuc2lvbnMgPSBuZXcgRXh0ZW5zaW9ucyh0aGlzKVxuICB9XG5cbiAgLyoqXG4gICAqIE1pbmlvIGV4dGVuc2lvbnMgdGhhdCBhcmVuJ3QgbmVjZXNzYXJ5IHByZXNlbnQgZm9yIEFtYXpvbiBTMyBjb21wYXRpYmxlIHN0b3JhZ2Ugc2VydmVyc1xuICAgKi9cbiAgZ2V0IGV4dGVuc2lvbnMoKSB7XG4gICAgcmV0dXJuIHRoaXMuY2xpZW50RXh0ZW5zaW9uc1xuICB9XG5cbiAgLyoqXG4gICAqIEBwYXJhbSBlbmRQb2ludCAtIHZhbGlkIFMzIGFjY2VsZXJhdGlvbiBlbmQgcG9pbnRcbiAgICovXG4gIHNldFMzVHJhbnNmZXJBY2NlbGVyYXRlKGVuZFBvaW50OiBzdHJpbmcpIHtcbiAgICB0aGlzLnMzQWNjZWxlcmF0ZUVuZHBvaW50ID0gZW5kUG9pbnRcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXRzIHRoZSBzdXBwb3J0ZWQgcmVxdWVzdCBvcHRpb25zLlxuICAgKi9cbiAgcHVibGljIHNldFJlcXVlc3RPcHRpb25zKG9wdGlvbnM6IFBpY2s8aHR0cHMuUmVxdWVzdE9wdGlvbnMsICh0eXBlb2YgcmVxdWVzdE9wdGlvblByb3BlcnRpZXMpW251bWJlcl0+KSB7XG4gICAgaWYgKCFpc09iamVjdChvcHRpb25zKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVxdWVzdCBvcHRpb25zIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cbiAgICB0aGlzLnJlcU9wdGlvbnMgPSBfLnBpY2sob3B0aW9ucywgcmVxdWVzdE9wdGlvblByb3BlcnRpZXMpXG4gIH1cblxuICAvKipcbiAgICogIFRoaXMgaXMgczMgU3BlY2lmaWMgYW5kIGRvZXMgbm90IGhvbGQgdmFsaWRpdHkgaW4gYW55IG90aGVyIE9iamVjdCBzdG9yYWdlLlxuICAgKi9cbiAgcHJpdmF0ZSBnZXRBY2NlbGVyYXRlRW5kUG9pbnRJZlNldChidWNrZXROYW1lPzogc3RyaW5nLCBvYmplY3ROYW1lPzogc3RyaW5nKSB7XG4gICAgaWYgKCFpc0VtcHR5KHRoaXMuczNBY2NlbGVyYXRlRW5kcG9pbnQpICYmICFpc0VtcHR5KGJ1Y2tldE5hbWUpICYmICFpc0VtcHR5KG9iamVjdE5hbWUpKSB7XG4gICAgICAvLyBodHRwOi8vZG9jcy5hd3MuYW1hem9uLmNvbS9BbWF6b25TMy9sYXRlc3QvZGV2L3RyYW5zZmVyLWFjY2VsZXJhdGlvbi5odG1sXG4gICAgICAvLyBEaXNhYmxlIHRyYW5zZmVyIGFjY2VsZXJhdGlvbiBmb3Igbm9uLWNvbXBsaWFudCBidWNrZXQgbmFtZXMuXG4gICAgICBpZiAoYnVja2V0TmFtZS5pbmNsdWRlcygnLicpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVHJhbnNmZXIgQWNjZWxlcmF0aW9uIGlzIG5vdCBzdXBwb3J0ZWQgZm9yIG5vbiBjb21wbGlhbnQgYnVja2V0OiR7YnVja2V0TmFtZX1gKVxuICAgICAgfVxuICAgICAgLy8gSWYgdHJhbnNmZXIgYWNjZWxlcmF0aW9uIGlzIHJlcXVlc3RlZCBzZXQgbmV3IGhvc3QuXG4gICAgICAvLyBGb3IgbW9yZSBkZXRhaWxzIGFib3V0IGVuYWJsaW5nIHRyYW5zZmVyIGFjY2VsZXJhdGlvbiByZWFkIGhlcmUuXG4gICAgICAvLyBodHRwOi8vZG9jcy5hd3MuYW1hem9uLmNvbS9BbWF6b25TMy9sYXRlc3QvZGV2L3RyYW5zZmVyLWFjY2VsZXJhdGlvbi5odG1sXG4gICAgICByZXR1cm4gdGhpcy5zM0FjY2VsZXJhdGVFbmRwb2ludFxuICAgIH1cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiByZXR1cm5zIG9wdGlvbnMgb2JqZWN0IHRoYXQgY2FuIGJlIHVzZWQgd2l0aCBodHRwLnJlcXVlc3QoKVxuICAgKiBUYWtlcyBjYXJlIG9mIGNvbnN0cnVjdGluZyB2aXJ0dWFsLWhvc3Qtc3R5bGUgb3IgcGF0aC1zdHlsZSBob3N0bmFtZVxuICAgKi9cbiAgcHJvdGVjdGVkIGdldFJlcXVlc3RPcHRpb25zKFxuICAgIG9wdHM6IFJlcXVlc3RPcHRpb24gJiB7XG4gICAgICByZWdpb246IHN0cmluZ1xuICAgIH0sXG4gICk6IElSZXF1ZXN0ICYge1xuICAgIGhvc3Q6IHN0cmluZ1xuICAgIGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz5cbiAgfSB7XG4gICAgY29uc3QgbWV0aG9kID0gb3B0cy5tZXRob2RcbiAgICBjb25zdCByZWdpb24gPSBvcHRzLnJlZ2lvblxuICAgIGNvbnN0IGJ1Y2tldE5hbWUgPSBvcHRzLmJ1Y2tldE5hbWVcbiAgICBsZXQgb2JqZWN0TmFtZSA9IG9wdHMub2JqZWN0TmFtZVxuICAgIGNvbnN0IGhlYWRlcnMgPSBvcHRzLmhlYWRlcnNcbiAgICBjb25zdCBxdWVyeSA9IG9wdHMucXVlcnlcblxuICAgIGxldCByZXFPcHRpb25zID0ge1xuICAgICAgbWV0aG9kLFxuICAgICAgaGVhZGVyczoge30gYXMgUmVxdWVzdEhlYWRlcnMsXG4gICAgICBwcm90b2NvbDogdGhpcy5wcm90b2NvbCxcbiAgICAgIC8vIElmIGN1c3RvbSB0cmFuc3BvcnRBZ2VudCB3YXMgc3VwcGxpZWQgZWFybGllciwgd2UnbGwgaW5qZWN0IGl0IGhlcmVcbiAgICAgIGFnZW50OiB0aGlzLnRyYW5zcG9ydEFnZW50LFxuICAgIH1cblxuICAgIC8vIFZlcmlmeSBpZiB2aXJ0dWFsIGhvc3Qgc3VwcG9ydGVkLlxuICAgIGxldCB2aXJ0dWFsSG9zdFN0eWxlXG4gICAgaWYgKGJ1Y2tldE5hbWUpIHtcbiAgICAgIHZpcnR1YWxIb3N0U3R5bGUgPSBpc1ZpcnR1YWxIb3N0U3R5bGUodGhpcy5ob3N0LCB0aGlzLnByb3RvY29sLCBidWNrZXROYW1lLCB0aGlzLnBhdGhTdHlsZSlcbiAgICB9XG5cbiAgICBsZXQgcGF0aCA9ICcvJ1xuICAgIGxldCBob3N0ID0gdGhpcy5ob3N0XG5cbiAgICBsZXQgcG9ydDogdW5kZWZpbmVkIHwgbnVtYmVyXG4gICAgaWYgKHRoaXMucG9ydCkge1xuICAgICAgcG9ydCA9IHRoaXMucG9ydFxuICAgIH1cblxuICAgIGlmIChvYmplY3ROYW1lKSB7XG4gICAgICBvYmplY3ROYW1lID0gdXJpUmVzb3VyY2VFc2NhcGUob2JqZWN0TmFtZSlcbiAgICB9XG5cbiAgICAvLyBGb3IgQW1hem9uIFMzIGVuZHBvaW50LCBnZXQgZW5kcG9pbnQgYmFzZWQgb24gcmVnaW9uLlxuICAgIGlmIChpc0FtYXpvbkVuZHBvaW50KGhvc3QpKSB7XG4gICAgICBjb25zdCBhY2NlbGVyYXRlRW5kUG9pbnQgPSB0aGlzLmdldEFjY2VsZXJhdGVFbmRQb2ludElmU2V0KGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUpXG4gICAgICBpZiAoYWNjZWxlcmF0ZUVuZFBvaW50KSB7XG4gICAgICAgIGhvc3QgPSBgJHthY2NlbGVyYXRlRW5kUG9pbnR9YFxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaG9zdCA9IGdldFMzRW5kcG9pbnQocmVnaW9uKVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICh2aXJ0dWFsSG9zdFN0eWxlICYmICFvcHRzLnBhdGhTdHlsZSkge1xuICAgICAgLy8gRm9yIGFsbCBob3N0cyB3aGljaCBzdXBwb3J0IHZpcnR1YWwgaG9zdCBzdHlsZSwgYGJ1Y2tldE5hbWVgXG4gICAgICAvLyBpcyBwYXJ0IG9mIHRoZSBob3N0bmFtZSBpbiB0aGUgZm9sbG93aW5nIGZvcm1hdDpcbiAgICAgIC8vXG4gICAgICAvLyAgdmFyIGhvc3QgPSAnYnVja2V0TmFtZS5leGFtcGxlLmNvbSdcbiAgICAgIC8vXG4gICAgICBpZiAoYnVja2V0TmFtZSkge1xuICAgICAgICBob3N0ID0gYCR7YnVja2V0TmFtZX0uJHtob3N0fWBcbiAgICAgIH1cbiAgICAgIGlmIChvYmplY3ROYW1lKSB7XG4gICAgICAgIHBhdGggPSBgLyR7b2JqZWN0TmFtZX1gXG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIEZvciBhbGwgUzMgY29tcGF0aWJsZSBzdG9yYWdlIHNlcnZpY2VzIHdlIHdpbGwgZmFsbGJhY2sgdG9cbiAgICAgIC8vIHBhdGggc3R5bGUgcmVxdWVzdHMsIHdoZXJlIGBidWNrZXROYW1lYCBpcyBwYXJ0IG9mIHRoZSBVUklcbiAgICAgIC8vIHBhdGguXG4gICAgICBpZiAoYnVja2V0TmFtZSkge1xuICAgICAgICBwYXRoID0gYC8ke2J1Y2tldE5hbWV9YFxuICAgICAgfVxuICAgICAgaWYgKG9iamVjdE5hbWUpIHtcbiAgICAgICAgcGF0aCA9IGAvJHtidWNrZXROYW1lfS8ke29iamVjdE5hbWV9YFxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChxdWVyeSkge1xuICAgICAgcGF0aCArPSBgPyR7cXVlcnl9YFxuICAgIH1cbiAgICByZXFPcHRpb25zLmhlYWRlcnMuaG9zdCA9IGhvc3RcbiAgICBpZiAoKHJlcU9wdGlvbnMucHJvdG9jb2wgPT09ICdodHRwOicgJiYgcG9ydCAhPT0gODApIHx8IChyZXFPcHRpb25zLnByb3RvY29sID09PSAnaHR0cHM6JyAmJiBwb3J0ICE9PSA0NDMpKSB7XG4gICAgICByZXFPcHRpb25zLmhlYWRlcnMuaG9zdCA9IGpvaW5Ib3N0UG9ydChob3N0LCBwb3J0KVxuICAgIH1cblxuICAgIHJlcU9wdGlvbnMuaGVhZGVyc1sndXNlci1hZ2VudCddID0gdGhpcy51c2VyQWdlbnRcbiAgICBpZiAoaGVhZGVycykge1xuICAgICAgLy8gaGF2ZSBhbGwgaGVhZGVyIGtleXMgaW4gbG93ZXIgY2FzZSAtIHRvIG1ha2Ugc2lnbmluZyBlYXN5XG4gICAgICBmb3IgKGNvbnN0IFtrLCB2XSBvZiBPYmplY3QuZW50cmllcyhoZWFkZXJzKSkge1xuICAgICAgICByZXFPcHRpb25zLmhlYWRlcnNbay50b0xvd2VyQ2FzZSgpXSA9IHZcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBVc2UgYW55IHJlcXVlc3Qgb3B0aW9uIHNwZWNpZmllZCBpbiBtaW5pb0NsaWVudC5zZXRSZXF1ZXN0T3B0aW9ucygpXG4gICAgcmVxT3B0aW9ucyA9IE9iamVjdC5hc3NpZ24oe30sIHRoaXMucmVxT3B0aW9ucywgcmVxT3B0aW9ucylcblxuICAgIHJldHVybiB7XG4gICAgICAuLi5yZXFPcHRpb25zLFxuICAgICAgaGVhZGVyczogXy5tYXBWYWx1ZXMoXy5waWNrQnkocmVxT3B0aW9ucy5oZWFkZXJzLCBpc0RlZmluZWQpLCAodikgPT4gdi50b1N0cmluZygpKSxcbiAgICAgIGhvc3QsXG4gICAgICBwb3J0LFxuICAgICAgcGF0aCxcbiAgICB9IHNhdGlzZmllcyBodHRwcy5SZXF1ZXN0T3B0aW9uc1xuICB9XG5cbiAgcHVibGljIGFzeW5jIHNldENyZWRlbnRpYWxzUHJvdmlkZXIoY3JlZGVudGlhbHNQcm92aWRlcjogQ3JlZGVudGlhbFByb3ZpZGVyKSB7XG4gICAgaWYgKCEoY3JlZGVudGlhbHNQcm92aWRlciBpbnN0YW5jZW9mIENyZWRlbnRpYWxQcm92aWRlcikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignVW5hYmxlIHRvIGdldCBjcmVkZW50aWFscy4gRXhwZWN0ZWQgaW5zdGFuY2Ugb2YgQ3JlZGVudGlhbFByb3ZpZGVyJylcbiAgICB9XG4gICAgdGhpcy5jcmVkZW50aWFsc1Byb3ZpZGVyID0gY3JlZGVudGlhbHNQcm92aWRlclxuICAgIGF3YWl0IHRoaXMuY2hlY2tBbmRSZWZyZXNoQ3JlZHMoKVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBjaGVja0FuZFJlZnJlc2hDcmVkcygpIHtcbiAgICBpZiAodGhpcy5jcmVkZW50aWFsc1Byb3ZpZGVyKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBjcmVkZW50aWFsc0NvbmYgPSBhd2FpdCB0aGlzLmNyZWRlbnRpYWxzUHJvdmlkZXIuZ2V0Q3JlZGVudGlhbHMoKVxuICAgICAgICB0aGlzLmFjY2Vzc0tleSA9IGNyZWRlbnRpYWxzQ29uZi5nZXRBY2Nlc3NLZXkoKVxuICAgICAgICB0aGlzLnNlY3JldEtleSA9IGNyZWRlbnRpYWxzQ29uZi5nZXRTZWNyZXRLZXkoKVxuICAgICAgICB0aGlzLnNlc3Npb25Ub2tlbiA9IGNyZWRlbnRpYWxzQ29uZi5nZXRTZXNzaW9uVG9rZW4oKVxuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuYWJsZSB0byBnZXQgY3JlZGVudGlhbHM6ICR7ZX1gLCB7IGNhdXNlOiBlIH0pXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBsb2dTdHJlYW0/OiBzdHJlYW0uV3JpdGFibGVcblxuICAvKipcbiAgICogbG9nIHRoZSByZXF1ZXN0LCByZXNwb25zZSwgZXJyb3JcbiAgICovXG4gIHByaXZhdGUgbG9nSFRUUChyZXFPcHRpb25zOiBJUmVxdWVzdCwgcmVzcG9uc2U6IGh0dHAuSW5jb21pbmdNZXNzYWdlIHwgbnVsbCwgZXJyPzogdW5rbm93bikge1xuICAgIC8vIGlmIG5vIGxvZ1N0cmVhbSBhdmFpbGFibGUgcmV0dXJuLlxuICAgIGlmICghdGhpcy5sb2dTdHJlYW0pIHtcbiAgICAgIHJldHVyblxuICAgIH1cbiAgICBpZiAoIWlzT2JqZWN0KHJlcU9wdGlvbnMpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZXFPcHRpb25zIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cbiAgICBpZiAocmVzcG9uc2UgJiYgIWlzUmVhZGFibGVTdHJlYW0ocmVzcG9uc2UpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZXNwb25zZSBzaG91bGQgYmUgb2YgdHlwZSBcIlN0cmVhbVwiJylcbiAgICB9XG4gICAgaWYgKGVyciAmJiAhKGVyciBpbnN0YW5jZW9mIEVycm9yKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignZXJyIHNob3VsZCBiZSBvZiB0eXBlIFwiRXJyb3JcIicpXG4gICAgfVxuICAgIGNvbnN0IGxvZ1N0cmVhbSA9IHRoaXMubG9nU3RyZWFtXG4gICAgY29uc3QgbG9nSGVhZGVycyA9IChoZWFkZXJzOiBSZXF1ZXN0SGVhZGVycykgPT4ge1xuICAgICAgT2JqZWN0LmVudHJpZXMoaGVhZGVycykuZm9yRWFjaCgoW2ssIHZdKSA9PiB7XG4gICAgICAgIGlmIChrID09ICdhdXRob3JpemF0aW9uJykge1xuICAgICAgICAgIGlmIChpc1N0cmluZyh2KSkge1xuICAgICAgICAgICAgY29uc3QgcmVkYWN0b3IgPSBuZXcgUmVnRXhwKCdTaWduYXR1cmU9KFswLTlhLWZdKyknKVxuICAgICAgICAgICAgdiA9IHYucmVwbGFjZShyZWRhY3RvciwgJ1NpZ25hdHVyZT0qKlJFREFDVEVEKionKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBsb2dTdHJlYW0ud3JpdGUoYCR7a306ICR7dn1cXG5gKVxuICAgICAgfSlcbiAgICAgIGxvZ1N0cmVhbS53cml0ZSgnXFxuJylcbiAgICB9XG4gICAgbG9nU3RyZWFtLndyaXRlKGBSRVFVRVNUOiAke3JlcU9wdGlvbnMubWV0aG9kfSAke3JlcU9wdGlvbnMucGF0aH1cXG5gKVxuICAgIGxvZ0hlYWRlcnMocmVxT3B0aW9ucy5oZWFkZXJzKVxuICAgIGlmIChyZXNwb25zZSkge1xuICAgICAgdGhpcy5sb2dTdHJlYW0ud3JpdGUoYFJFU1BPTlNFOiAke3Jlc3BvbnNlLnN0YXR1c0NvZGV9XFxuYClcbiAgICAgIGxvZ0hlYWRlcnMocmVzcG9uc2UuaGVhZGVycyBhcyBSZXF1ZXN0SGVhZGVycylcbiAgICB9XG4gICAgaWYgKGVycikge1xuICAgICAgbG9nU3RyZWFtLndyaXRlKCdFUlJPUiBCT0RZOlxcbicpXG4gICAgICBjb25zdCBlcnJKU09OID0gSlNPTi5zdHJpbmdpZnkoZXJyLCBudWxsLCAnXFx0JylcbiAgICAgIGxvZ1N0cmVhbS53cml0ZShgJHtlcnJKU09OfVxcbmApXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEVuYWJsZSB0cmFjaW5nXG4gICAqL1xuICBwdWJsaWMgdHJhY2VPbihzdHJlYW0/OiBzdHJlYW0uV3JpdGFibGUpIHtcbiAgICBpZiAoIXN0cmVhbSkge1xuICAgICAgc3RyZWFtID0gcHJvY2Vzcy5zdGRvdXRcbiAgICB9XG4gICAgdGhpcy5sb2dTdHJlYW0gPSBzdHJlYW1cbiAgfVxuXG4gIC8qKlxuICAgKiBEaXNhYmxlIHRyYWNpbmdcbiAgICovXG4gIHB1YmxpYyB0cmFjZU9mZigpIHtcbiAgICB0aGlzLmxvZ1N0cmVhbSA9IHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIG1ha2VSZXF1ZXN0IGlzIHRoZSBwcmltaXRpdmUgdXNlZCBieSB0aGUgYXBpcyBmb3IgbWFraW5nIFMzIHJlcXVlc3RzLlxuICAgKiBwYXlsb2FkIGNhbiBiZSBlbXB0eSBzdHJpbmcgaW4gY2FzZSBvZiBubyBwYXlsb2FkLlxuICAgKiBzdGF0dXNDb2RlIGlzIHRoZSBleHBlY3RlZCBzdGF0dXNDb2RlLiBJZiByZXNwb25zZS5zdGF0dXNDb2RlIGRvZXMgbm90IG1hdGNoXG4gICAqIHdlIHBhcnNlIHRoZSBYTUwgZXJyb3IgYW5kIGNhbGwgdGhlIGNhbGxiYWNrIHdpdGggdGhlIGVycm9yIG1lc3NhZ2UuXG4gICAqXG4gICAqIEEgdmFsaWQgcmVnaW9uIGlzIHBhc3NlZCBieSB0aGUgY2FsbHMgLSBsaXN0QnVja2V0cywgbWFrZUJ1Y2tldCBhbmQgZ2V0QnVja2V0UmVnaW9uLlxuICAgKlxuICAgKiBAaW50ZXJuYWxcbiAgICovXG4gIGFzeW5jIG1ha2VSZXF1ZXN0QXN5bmMoXG4gICAgb3B0aW9uczogUmVxdWVzdE9wdGlvbixcbiAgICBwYXlsb2FkOiBCaW5hcnkgPSAnJyxcbiAgICBleHBlY3RlZENvZGVzOiBudW1iZXJbXSA9IFsyMDBdLFxuICAgIHJlZ2lvbiA9ICcnLFxuICApOiBQcm9taXNlPGh0dHAuSW5jb21pbmdNZXNzYWdlPiB7XG4gICAgaWYgKCFpc09iamVjdChvcHRpb25zKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignb3B0aW9ucyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhwYXlsb2FkKSAmJiAhaXNPYmplY3QocGF5bG9hZCkpIHtcbiAgICAgIC8vIEJ1ZmZlciBpcyBvZiB0eXBlICdvYmplY3QnXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdwYXlsb2FkIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCIgb3IgXCJCdWZmZXJcIicpXG4gICAgfVxuICAgIGV4cGVjdGVkQ29kZXMuZm9yRWFjaCgoc3RhdHVzQ29kZSkgPT4ge1xuICAgICAgaWYgKCFpc051bWJlcihzdGF0dXNDb2RlKSkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdzdGF0dXNDb2RlIHNob3VsZCBiZSBvZiB0eXBlIFwibnVtYmVyXCInKVxuICAgICAgfVxuICAgIH0pXG4gICAgaWYgKCFpc1N0cmluZyhyZWdpb24pKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZWdpb24gc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmICghb3B0aW9ucy5oZWFkZXJzKSB7XG4gICAgICBvcHRpb25zLmhlYWRlcnMgPSB7fVxuICAgIH1cbiAgICBpZiAob3B0aW9ucy5tZXRob2QgPT09ICdQT1NUJyB8fCBvcHRpb25zLm1ldGhvZCA9PT0gJ1BVVCcgfHwgb3B0aW9ucy5tZXRob2QgPT09ICdERUxFVEUnKSB7XG4gICAgICBvcHRpb25zLmhlYWRlcnNbJ2NvbnRlbnQtbGVuZ3RoJ10gPSBwYXlsb2FkLmxlbmd0aC50b1N0cmluZygpXG4gICAgfVxuICAgIGNvbnN0IHNoYTI1NnN1bSA9IHRoaXMuZW5hYmxlU0hBMjU2ID8gdG9TaGEyNTYocGF5bG9hZCkgOiAnJ1xuICAgIHJldHVybiB0aGlzLm1ha2VSZXF1ZXN0U3RyZWFtQXN5bmMob3B0aW9ucywgcGF5bG9hZCwgc2hhMjU2c3VtLCBleHBlY3RlZENvZGVzLCByZWdpb24pXG4gIH1cblxuICAvKipcbiAgICogbmV3IHJlcXVlc3Qgd2l0aCBwcm9taXNlXG4gICAqXG4gICAqIE5vIG5lZWQgdG8gZHJhaW4gcmVzcG9uc2UsIHJlc3BvbnNlIGJvZHkgaXMgbm90IHZhbGlkXG4gICAqL1xuICBhc3luYyBtYWtlUmVxdWVzdEFzeW5jT21pdChcbiAgICBvcHRpb25zOiBSZXF1ZXN0T3B0aW9uLFxuICAgIHBheWxvYWQ6IEJpbmFyeSA9ICcnLFxuICAgIHN0YXR1c0NvZGVzOiBudW1iZXJbXSA9IFsyMDBdLFxuICAgIHJlZ2lvbiA9ICcnLFxuICApOiBQcm9taXNlPE9taXQ8aHR0cC5JbmNvbWluZ01lc3NhZ2UsICdvbic+PiB7XG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKG9wdGlvbnMsIHBheWxvYWQsIHN0YXR1c0NvZGVzLCByZWdpb24pXG4gICAgYXdhaXQgZHJhaW5SZXNwb25zZShyZXMpXG4gICAgcmV0dXJuIHJlc1xuICB9XG5cbiAgLyoqXG4gICAqIG1ha2VSZXF1ZXN0U3RyZWFtIHdpbGwgYmUgdXNlZCBkaXJlY3RseSBpbnN0ZWFkIG9mIG1ha2VSZXF1ZXN0IGluIGNhc2UgdGhlIHBheWxvYWRcbiAgICogaXMgYXZhaWxhYmxlIGFzIGEgc3RyZWFtLiBmb3IgZXguIHB1dE9iamVjdFxuICAgKlxuICAgKiBAaW50ZXJuYWxcbiAgICovXG4gIGFzeW5jIG1ha2VSZXF1ZXN0U3RyZWFtQXN5bmMoXG4gICAgb3B0aW9uczogUmVxdWVzdE9wdGlvbixcbiAgICBib2R5OiBzdHJlYW0uUmVhZGFibGUgfCBCaW5hcnksXG4gICAgc2hhMjU2c3VtOiBzdHJpbmcsXG4gICAgc3RhdHVzQ29kZXM6IG51bWJlcltdLFxuICAgIHJlZ2lvbjogc3RyaW5nLFxuICApOiBQcm9taXNlPGh0dHAuSW5jb21pbmdNZXNzYWdlPiB7XG4gICAgaWYgKCFpc09iamVjdChvcHRpb25zKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignb3B0aW9ucyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG4gICAgaWYgKCEoQnVmZmVyLmlzQnVmZmVyKGJvZHkpIHx8IHR5cGVvZiBib2R5ID09PSAnc3RyaW5nJyB8fCBpc1JlYWRhYmxlU3RyZWFtKGJvZHkpKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihcbiAgICAgICAgYHN0cmVhbSBzaG91bGQgYmUgYSBCdWZmZXIsIHN0cmluZyBvciByZWFkYWJsZSBTdHJlYW0sIGdvdCAke3R5cGVvZiBib2R5fSBpbnN0ZWFkYCxcbiAgICAgIClcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhzaGEyNTZzdW0pKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdzaGEyNTZzdW0gc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIHN0YXR1c0NvZGVzLmZvckVhY2goKHN0YXR1c0NvZGUpID0+IHtcbiAgICAgIGlmICghaXNOdW1iZXIoc3RhdHVzQ29kZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignc3RhdHVzQ29kZSBzaG91bGQgYmUgb2YgdHlwZSBcIm51bWJlclwiJylcbiAgICAgIH1cbiAgICB9KVxuICAgIGlmICghaXNTdHJpbmcocmVnaW9uKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVnaW9uIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICAvLyBzaGEyNTZzdW0gd2lsbCBiZSBlbXB0eSBmb3IgYW5vbnltb3VzIG9yIGh0dHBzIHJlcXVlc3RzXG4gICAgaWYgKCF0aGlzLmVuYWJsZVNIQTI1NiAmJiBzaGEyNTZzdW0ubGVuZ3RoICE9PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBzaGEyNTZzdW0gZXhwZWN0ZWQgdG8gYmUgZW1wdHkgZm9yIGFub255bW91cyBvciBodHRwcyByZXF1ZXN0c2ApXG4gICAgfVxuICAgIC8vIHNoYTI1NnN1bSBzaG91bGQgYmUgdmFsaWQgZm9yIG5vbi1hbm9ueW1vdXMgaHR0cCByZXF1ZXN0cy5cbiAgICBpZiAodGhpcy5lbmFibGVTSEEyNTYgJiYgc2hhMjU2c3VtLmxlbmd0aCAhPT0gNjQpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYEludmFsaWQgc2hhMjU2c3VtIDogJHtzaGEyNTZzdW19YClcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmNoZWNrQW5kUmVmcmVzaENyZWRzKClcblxuICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tbm9uLW51bGwtYXNzZXJ0aW9uXG4gICAgcmVnaW9uID0gcmVnaW9uIHx8IChhd2FpdCB0aGlzLmdldEJ1Y2tldFJlZ2lvbkFzeW5jKG9wdGlvbnMuYnVja2V0TmFtZSEpKVxuXG4gICAgY29uc3QgcmVxT3B0aW9ucyA9IHRoaXMuZ2V0UmVxdWVzdE9wdGlvbnMoeyAuLi5vcHRpb25zLCByZWdpb24gfSlcbiAgICBpZiAoIXRoaXMuYW5vbnltb3VzKSB7XG4gICAgICAvLyBGb3Igbm9uLWFub255bW91cyBodHRwcyByZXF1ZXN0cyBzaGEyNTZzdW0gaXMgJ1VOU0lHTkVELVBBWUxPQUQnIGZvciBzaWduYXR1cmUgY2FsY3VsYXRpb24uXG4gICAgICBpZiAoIXRoaXMuZW5hYmxlU0hBMjU2KSB7XG4gICAgICAgIHNoYTI1NnN1bSA9ICdVTlNJR05FRC1QQVlMT0FEJ1xuICAgICAgfVxuICAgICAgY29uc3QgZGF0ZSA9IG5ldyBEYXRlKClcbiAgICAgIHJlcU9wdGlvbnMuaGVhZGVyc1sneC1hbXotZGF0ZSddID0gbWFrZURhdGVMb25nKGRhdGUpXG4gICAgICByZXFPcHRpb25zLmhlYWRlcnNbJ3gtYW16LWNvbnRlbnQtc2hhMjU2J10gPSBzaGEyNTZzdW1cbiAgICAgIGlmICh0aGlzLnNlc3Npb25Ub2tlbikge1xuICAgICAgICByZXFPcHRpb25zLmhlYWRlcnNbJ3gtYW16LXNlY3VyaXR5LXRva2VuJ10gPSB0aGlzLnNlc3Npb25Ub2tlblxuICAgICAgfVxuICAgICAgcmVxT3B0aW9ucy5oZWFkZXJzLmF1dGhvcml6YXRpb24gPSBzaWduVjQocmVxT3B0aW9ucywgdGhpcy5hY2Nlc3NLZXksIHRoaXMuc2VjcmV0S2V5LCByZWdpb24sIGRhdGUsIHNoYTI1NnN1bSlcbiAgICB9XG5cbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHJlcXVlc3QodGhpcy50cmFuc3BvcnQsIHJlcU9wdGlvbnMsIGJvZHkpXG4gICAgaWYgKCFyZXNwb25zZS5zdGF0dXNDb2RlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJCVUc6IHJlc3BvbnNlIGRvZXNuJ3QgaGF2ZSBhIHN0YXR1c0NvZGVcIilcbiAgICB9XG5cbiAgICBpZiAoIXN0YXR1c0NvZGVzLmluY2x1ZGVzKHJlc3BvbnNlLnN0YXR1c0NvZGUpKSB7XG4gICAgICAvLyBGb3IgYW4gaW5jb3JyZWN0IHJlZ2lvbiwgUzMgc2VydmVyIGFsd2F5cyBzZW5kcyBiYWNrIDQwMC5cbiAgICAgIC8vIEJ1dCB3ZSB3aWxsIGRvIGNhY2hlIGludmFsaWRhdGlvbiBmb3IgYWxsIGVycm9ycyBzbyB0aGF0LFxuICAgICAgLy8gaW4gZnV0dXJlLCBpZiBBV1MgUzMgZGVjaWRlcyB0byBzZW5kIGEgZGlmZmVyZW50IHN0YXR1cyBjb2RlIG9yXG4gICAgICAvLyBYTUwgZXJyb3IgY29kZSB3ZSB3aWxsIHN0aWxsIHdvcmsgZmluZS5cbiAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tbm9uLW51bGwtYXNzZXJ0aW9uXG4gICAgICBkZWxldGUgdGhpcy5yZWdpb25NYXBbb3B0aW9ucy5idWNrZXROYW1lIV1cblxuICAgICAgY29uc3QgZXJyID0gYXdhaXQgeG1sUGFyc2Vycy5wYXJzZVJlc3BvbnNlRXJyb3IocmVzcG9uc2UpXG4gICAgICB0aGlzLmxvZ0hUVFAocmVxT3B0aW9ucywgcmVzcG9uc2UsIGVycilcbiAgICAgIHRocm93IGVyclxuICAgIH1cblxuICAgIHRoaXMubG9nSFRUUChyZXFPcHRpb25zLCByZXNwb25zZSlcblxuICAgIHJldHVybiByZXNwb25zZVxuICB9XG5cbiAgLyoqXG4gICAqIGdldHMgdGhlIHJlZ2lvbiBvZiB0aGUgYnVja2V0XG4gICAqXG4gICAqIEBwYXJhbSBidWNrZXROYW1lXG4gICAqXG4gICAqIEBpbnRlcm5hbFxuICAgKi9cbiAgcHJvdGVjdGVkIGFzeW5jIGdldEJ1Y2tldFJlZ2lvbkFzeW5jKGJ1Y2tldE5hbWU6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKGBJbnZhbGlkIGJ1Y2tldCBuYW1lIDogJHtidWNrZXROYW1lfWApXG4gICAgfVxuXG4gICAgLy8gUmVnaW9uIGlzIHNldCB3aXRoIGNvbnN0cnVjdG9yLCByZXR1cm4gdGhlIHJlZ2lvbiByaWdodCBoZXJlLlxuICAgIGlmICh0aGlzLnJlZ2lvbikge1xuICAgICAgcmV0dXJuIHRoaXMucmVnaW9uXG4gICAgfVxuXG4gICAgY29uc3QgY2FjaGVkID0gdGhpcy5yZWdpb25NYXBbYnVja2V0TmFtZV1cbiAgICBpZiAoY2FjaGVkKSB7XG4gICAgICByZXR1cm4gY2FjaGVkXG4gICAgfVxuXG4gICAgY29uc3QgZXh0cmFjdFJlZ2lvbkFzeW5jID0gYXN5bmMgKHJlc3BvbnNlOiBodHRwLkluY29taW5nTWVzc2FnZSkgPT4ge1xuICAgICAgY29uc3QgYm9keSA9IGF3YWl0IHJlYWRBc1N0cmluZyhyZXNwb25zZSlcbiAgICAgIGNvbnN0IHJlZ2lvbiA9IHhtbFBhcnNlcnMucGFyc2VCdWNrZXRSZWdpb24oYm9keSkgfHwgREVGQVVMVF9SRUdJT05cbiAgICAgIHRoaXMucmVnaW9uTWFwW2J1Y2tldE5hbWVdID0gcmVnaW9uXG4gICAgICByZXR1cm4gcmVnaW9uXG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcbiAgICBjb25zdCBxdWVyeSA9ICdsb2NhdGlvbidcbiAgICAvLyBgZ2V0QnVja2V0TG9jYXRpb25gIGJlaGF2ZXMgZGlmZmVyZW50bHkgaW4gZm9sbG93aW5nIHdheXMgZm9yXG4gICAgLy8gZGlmZmVyZW50IGVudmlyb25tZW50cy5cbiAgICAvL1xuICAgIC8vIC0gRm9yIG5vZGVqcyBlbnYgd2UgZGVmYXVsdCB0byBwYXRoIHN0eWxlIHJlcXVlc3RzLlxuICAgIC8vIC0gRm9yIGJyb3dzZXIgZW52IHBhdGggc3R5bGUgcmVxdWVzdHMgb24gYnVja2V0cyB5aWVsZHMgQ09SU1xuICAgIC8vICAgZXJyb3IuIFRvIGNpcmN1bXZlbnQgdGhpcyBwcm9ibGVtIHdlIG1ha2UgYSB2aXJ0dWFsIGhvc3RcbiAgICAvLyAgIHN0eWxlIHJlcXVlc3Qgc2lnbmVkIHdpdGggJ3VzLWVhc3QtMScuIFRoaXMgcmVxdWVzdCBmYWlsc1xuICAgIC8vICAgd2l0aCBhbiBlcnJvciAnQXV0aG9yaXphdGlvbkhlYWRlck1hbGZvcm1lZCcsIGFkZGl0aW9uYWxseVxuICAgIC8vICAgdGhlIGVycm9yIFhNTCBhbHNvIHByb3ZpZGVzIFJlZ2lvbiBvZiB0aGUgYnVja2V0LiBUbyB2YWxpZGF0ZVxuICAgIC8vICAgdGhpcyByZWdpb24gaXMgcHJvcGVyIHdlIHJldHJ5IHRoZSBzYW1lIHJlcXVlc3Qgd2l0aCB0aGUgbmV3bHlcbiAgICAvLyAgIG9idGFpbmVkIHJlZ2lvbi5cbiAgICBjb25zdCBwYXRoU3R5bGUgPSB0aGlzLnBhdGhTdHlsZSAmJiAhaXNCcm93c2VyXG4gICAgbGV0IHJlZ2lvbjogc3RyaW5nXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnksIHBhdGhTdHlsZSB9LCAnJywgWzIwMF0sIERFRkFVTFRfUkVHSU9OKVxuICAgICAgcmV0dXJuIGV4dHJhY3RSZWdpb25Bc3luYyhyZXMpXG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9iYW4tdHMtY29tbWVudFxuICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgaWYgKCEoZS5uYW1lID09PSAnQXV0aG9yaXphdGlvbkhlYWRlck1hbGZvcm1lZCcpKSB7XG4gICAgICAgIHRocm93IGVcbiAgICAgIH1cbiAgICAgIC8vIEB0cy1leHBlY3QtZXJyb3Igd2Ugc2V0IGV4dHJhIHByb3BlcnRpZXMgb24gZXJyb3Igb2JqZWN0XG4gICAgICByZWdpb24gPSBlLlJlZ2lvbiBhcyBzdHJpbmdcbiAgICAgIGlmICghcmVnaW9uKSB7XG4gICAgICAgIHRocm93IGVcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5LCBwYXRoU3R5bGUgfSwgJycsIFsyMDBdLCByZWdpb24pXG4gICAgcmV0dXJuIGF3YWl0IGV4dHJhY3RSZWdpb25Bc3luYyhyZXMpXG4gIH1cblxuICAvKipcbiAgICogbWFrZVJlcXVlc3QgaXMgdGhlIHByaW1pdGl2ZSB1c2VkIGJ5IHRoZSBhcGlzIGZvciBtYWtpbmcgUzMgcmVxdWVzdHMuXG4gICAqIHBheWxvYWQgY2FuIGJlIGVtcHR5IHN0cmluZyBpbiBjYXNlIG9mIG5vIHBheWxvYWQuXG4gICAqIHN0YXR1c0NvZGUgaXMgdGhlIGV4cGVjdGVkIHN0YXR1c0NvZGUuIElmIHJlc3BvbnNlLnN0YXR1c0NvZGUgZG9lcyBub3QgbWF0Y2hcbiAgICogd2UgcGFyc2UgdGhlIFhNTCBlcnJvciBhbmQgY2FsbCB0aGUgY2FsbGJhY2sgd2l0aCB0aGUgZXJyb3IgbWVzc2FnZS5cbiAgICogQSB2YWxpZCByZWdpb24gaXMgcGFzc2VkIGJ5IHRoZSBjYWxscyAtIGxpc3RCdWNrZXRzLCBtYWtlQnVja2V0IGFuZFxuICAgKiBnZXRCdWNrZXRSZWdpb24uXG4gICAqXG4gICAqIEBkZXByZWNhdGVkIHVzZSBgbWFrZVJlcXVlc3RBc3luY2AgaW5zdGVhZFxuICAgKi9cbiAgbWFrZVJlcXVlc3QoXG4gICAgb3B0aW9uczogUmVxdWVzdE9wdGlvbixcbiAgICBwYXlsb2FkOiBCaW5hcnkgPSAnJyxcbiAgICBleHBlY3RlZENvZGVzOiBudW1iZXJbXSA9IFsyMDBdLFxuICAgIHJlZ2lvbiA9ICcnLFxuICAgIHJldHVyblJlc3BvbnNlOiBib29sZWFuLFxuICAgIGNiOiAoY2I6IHVua25vd24sIHJlc3VsdDogaHR0cC5JbmNvbWluZ01lc3NhZ2UpID0+IHZvaWQsXG4gICkge1xuICAgIGxldCBwcm9tOiBQcm9taXNlPGh0dHAuSW5jb21pbmdNZXNzYWdlPlxuICAgIGlmIChyZXR1cm5SZXNwb25zZSkge1xuICAgICAgcHJvbSA9IHRoaXMubWFrZVJlcXVlc3RBc3luYyhvcHRpb25zLCBwYXlsb2FkLCBleHBlY3RlZENvZGVzLCByZWdpb24pXG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvYmFuLXRzLWNvbW1lbnRcbiAgICAgIC8vIEB0cy1leHBlY3QtZXJyb3IgY29tcGF0aWJsZSBmb3Igb2xkIGJlaGF2aW91clxuICAgICAgcHJvbSA9IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQob3B0aW9ucywgcGF5bG9hZCwgZXhwZWN0ZWRDb2RlcywgcmVnaW9uKVxuICAgIH1cblxuICAgIHByb20udGhlbihcbiAgICAgIChyZXN1bHQpID0+IGNiKG51bGwsIHJlc3VsdCksXG4gICAgICAoZXJyKSA9PiB7XG4gICAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvYmFuLXRzLWNvbW1lbnRcbiAgICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgICBjYihlcnIpXG4gICAgICB9LFxuICAgIClcbiAgfVxuXG4gIC8qKlxuICAgKiBtYWtlUmVxdWVzdFN0cmVhbSB3aWxsIGJlIHVzZWQgZGlyZWN0bHkgaW5zdGVhZCBvZiBtYWtlUmVxdWVzdCBpbiBjYXNlIHRoZSBwYXlsb2FkXG4gICAqIGlzIGF2YWlsYWJsZSBhcyBhIHN0cmVhbS4gZm9yIGV4LiBwdXRPYmplY3RcbiAgICpcbiAgICogQGRlcHJlY2F0ZWQgdXNlIGBtYWtlUmVxdWVzdFN0cmVhbUFzeW5jYCBpbnN0ZWFkXG4gICAqL1xuICBtYWtlUmVxdWVzdFN0cmVhbShcbiAgICBvcHRpb25zOiBSZXF1ZXN0T3B0aW9uLFxuICAgIHN0cmVhbTogc3RyZWFtLlJlYWRhYmxlIHwgQnVmZmVyLFxuICAgIHNoYTI1NnN1bTogc3RyaW5nLFxuICAgIHN0YXR1c0NvZGVzOiBudW1iZXJbXSxcbiAgICByZWdpb246IHN0cmluZyxcbiAgICByZXR1cm5SZXNwb25zZTogYm9vbGVhbixcbiAgICBjYjogKGNiOiB1bmtub3duLCByZXN1bHQ6IGh0dHAuSW5jb21pbmdNZXNzYWdlKSA9PiB2b2lkLFxuICApIHtcbiAgICBjb25zdCBleGVjdXRvciA9IGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RTdHJlYW1Bc3luYyhvcHRpb25zLCBzdHJlYW0sIHNoYTI1NnN1bSwgc3RhdHVzQ29kZXMsIHJlZ2lvbilcbiAgICAgIGlmICghcmV0dXJuUmVzcG9uc2UpIHtcbiAgICAgICAgYXdhaXQgZHJhaW5SZXNwb25zZShyZXMpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiByZXNcbiAgICB9XG5cbiAgICBleGVjdXRvcigpLnRoZW4oXG4gICAgICAocmVzdWx0KSA9PiBjYihudWxsLCByZXN1bHQpLFxuICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9iYW4tdHMtY29tbWVudFxuICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgKGVycikgPT4gY2IoZXJyKSxcbiAgICApXG4gIH1cblxuICAvKipcbiAgICogQGRlcHJlY2F0ZWQgdXNlIGBnZXRCdWNrZXRSZWdpb25Bc3luY2AgaW5zdGVhZFxuICAgKi9cbiAgZ2V0QnVja2V0UmVnaW9uKGJ1Y2tldE5hbWU6IHN0cmluZywgY2I6IChlcnI6IHVua25vd24sIHJlZ2lvbjogc3RyaW5nKSA9PiB2b2lkKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0QnVja2V0UmVnaW9uQXN5bmMoYnVja2V0TmFtZSkudGhlbihcbiAgICAgIChyZXN1bHQpID0+IGNiKG51bGwsIHJlc3VsdCksXG4gICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L2Jhbi10cy1jb21tZW50XG4gICAgICAvLyBAdHMtaWdub3JlXG4gICAgICAoZXJyKSA9PiBjYihlcnIpLFxuICAgIClcbiAgfVxuXG4gIC8vIEJ1Y2tldCBvcGVyYXRpb25zXG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgdGhlIGJ1Y2tldCBgYnVja2V0TmFtZWAuXG4gICAqXG4gICAqL1xuICBhc3luYyBtYWtlQnVja2V0KGJ1Y2tldE5hbWU6IHN0cmluZywgcmVnaW9uOiBSZWdpb24gPSAnJywgbWFrZU9wdHM6IE1ha2VCdWNrZXRPcHQgPSB7fSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIC8vIEJhY2t3YXJkIENvbXBhdGliaWxpdHlcbiAgICBpZiAoaXNPYmplY3QocmVnaW9uKSkge1xuICAgICAgbWFrZU9wdHMgPSByZWdpb25cbiAgICAgIHJlZ2lvbiA9ICcnXG4gICAgfVxuXG4gICAgaWYgKCFpc1N0cmluZyhyZWdpb24pKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZWdpb24gc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmICghaXNPYmplY3QobWFrZU9wdHMpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdtYWtlT3B0cyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG5cbiAgICBsZXQgcGF5bG9hZCA9ICcnXG5cbiAgICAvLyBSZWdpb24gYWxyZWFkeSBzZXQgaW4gY29uc3RydWN0b3IsIHZhbGlkYXRlIGlmXG4gICAgLy8gY2FsbGVyIHJlcXVlc3RlZCBidWNrZXQgbG9jYXRpb24gaXMgc2FtZS5cbiAgICBpZiAocmVnaW9uICYmIHRoaXMucmVnaW9uKSB7XG4gICAgICBpZiAocmVnaW9uICE9PSB0aGlzLnJlZ2lvbikge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBDb25maWd1cmVkIHJlZ2lvbiAke3RoaXMucmVnaW9ufSwgcmVxdWVzdGVkICR7cmVnaW9ufWApXG4gICAgICB9XG4gICAgfVxuICAgIC8vIHNlbmRpbmcgbWFrZUJ1Y2tldCByZXF1ZXN0IHdpdGggWE1MIGNvbnRhaW5pbmcgJ3VzLWVhc3QtMScgZmFpbHMuIEZvclxuICAgIC8vIGRlZmF1bHQgcmVnaW9uIHNlcnZlciBleHBlY3RzIHRoZSByZXF1ZXN0IHdpdGhvdXQgYm9keVxuICAgIGlmIChyZWdpb24gJiYgcmVnaW9uICE9PSBERUZBVUxUX1JFR0lPTikge1xuICAgICAgcGF5bG9hZCA9IHhtbC5idWlsZE9iamVjdCh7XG4gICAgICAgIENyZWF0ZUJ1Y2tldENvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgICAkOiB7IHhtbG5zOiAnaHR0cDovL3MzLmFtYXpvbmF3cy5jb20vZG9jLzIwMDYtMDMtMDEvJyB9LFxuICAgICAgICAgIExvY2F0aW9uQ29uc3RyYWludDogcmVnaW9uLFxuICAgICAgICB9LFxuICAgICAgfSlcbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcbiAgICBjb25zdCBoZWFkZXJzOiBSZXF1ZXN0SGVhZGVycyA9IHt9XG5cbiAgICBpZiAobWFrZU9wdHMuT2JqZWN0TG9ja2luZykge1xuICAgICAgaGVhZGVyc1sneC1hbXotYnVja2V0LW9iamVjdC1sb2NrLWVuYWJsZWQnXSA9IHRydWVcbiAgICB9XG5cbiAgICBpZiAoIXJlZ2lvbikge1xuICAgICAgcmVnaW9uID0gREVGQVVMVF9SRUdJT05cbiAgICB9XG4gICAgY29uc3QgZmluYWxSZWdpb24gPSByZWdpb24gLy8gdHlwZSBuYXJyb3dcbiAgICBjb25zdCByZXF1ZXN0T3B0OiBSZXF1ZXN0T3B0aW9uID0geyBtZXRob2QsIGJ1Y2tldE5hbWUsIGhlYWRlcnMgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQocmVxdWVzdE9wdCwgcGF5bG9hZCwgWzIwMF0sIGZpbmFsUmVnaW9uKVxuICAgIH0gY2F0Y2ggKGVycjogdW5rbm93bikge1xuICAgICAgaWYgKHJlZ2lvbiA9PT0gJycgfHwgcmVnaW9uID09PSBERUZBVUxUX1JFR0lPTikge1xuICAgICAgICBpZiAoZXJyIGluc3RhbmNlb2YgZXJyb3JzLlMzRXJyb3IpIHtcbiAgICAgICAgICBjb25zdCBlcnJDb2RlID0gZXJyLmNvZGVcbiAgICAgICAgICBjb25zdCBlcnJSZWdpb24gPSBlcnIucmVnaW9uXG4gICAgICAgICAgaWYgKGVyckNvZGUgPT09ICdBdXRob3JpemF0aW9uSGVhZGVyTWFsZm9ybWVkJyAmJiBlcnJSZWdpb24gIT09ICcnKSB7XG4gICAgICAgICAgICAvLyBSZXRyeSB3aXRoIHJlZ2lvbiByZXR1cm5lZCBhcyBwYXJ0IG9mIGVycm9yXG4gICAgICAgICAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHJlcXVlc3RPcHQsIHBheWxvYWQsIFsyMDBdLCBlcnJDb2RlKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgdGhyb3cgZXJyXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFRvIGNoZWNrIGlmIGEgYnVja2V0IGFscmVhZHkgZXhpc3RzLlxuICAgKi9cbiAgYXN5bmMgYnVja2V0RXhpc3RzKGJ1Y2tldE5hbWU6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdIRUFEJ1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lIH0pXG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAvLyBAdHMtaWdub3JlXG4gICAgICBpZiAoZXJyLmNvZGUgPT09ICdOb1N1Y2hCdWNrZXQnIHx8IGVyci5jb2RlID09PSAnTm90Rm91bmQnKSB7XG4gICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgfVxuICAgICAgdGhyb3cgZXJyXG4gICAgfVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIGFzeW5jIHJlbW92ZUJ1Y2tldChidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+XG5cbiAgLyoqXG4gICAqIEBkZXByZWNhdGVkIHVzZSBwcm9taXNlIHN0eWxlIEFQSVxuICAgKi9cbiAgcmVtb3ZlQnVja2V0KGJ1Y2tldE5hbWU6IHN0cmluZywgY2FsbGJhY2s6IE5vUmVzdWx0Q2FsbGJhY2spOiB2b2lkXG5cbiAgYXN5bmMgcmVtb3ZlQnVja2V0KGJ1Y2tldE5hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdERUxFVEUnXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSB9LCAnJywgWzIwNF0pXG4gICAgZGVsZXRlIHRoaXMucmVnaW9uTWFwW2J1Y2tldE5hbWVdXG4gIH1cblxuICAvKipcbiAgICogQ2FsbGJhY2sgaXMgY2FsbGVkIHdpdGggcmVhZGFibGUgc3RyZWFtIG9mIHRoZSBvYmplY3QgY29udGVudC5cbiAgICovXG4gIGFzeW5jIGdldE9iamVjdChcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXG4gICAgb2JqZWN0TmFtZTogc3RyaW5nLFxuICAgIGdldE9wdHM6IFZlcnNpb25JZGVudGlmaWNhdG9yID0ge30sXG4gICk6IFByb21pc2U8c3RyZWFtLlJlYWRhYmxlPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuZ2V0UGFydGlhbE9iamVjdChidWNrZXROYW1lLCBvYmplY3ROYW1lLCAwLCAwLCBnZXRPcHRzKVxuICB9XG5cbiAgLyoqXG4gICAqIENhbGxiYWNrIGlzIGNhbGxlZCB3aXRoIHJlYWRhYmxlIHN0cmVhbSBvZiB0aGUgcGFydGlhbCBvYmplY3QgY29udGVudC5cbiAgICogQHBhcmFtIGJ1Y2tldE5hbWVcbiAgICogQHBhcmFtIG9iamVjdE5hbWVcbiAgICogQHBhcmFtIG9mZnNldFxuICAgKiBAcGFyYW0gbGVuZ3RoIC0gbGVuZ3RoIG9mIHRoZSBvYmplY3QgdGhhdCB3aWxsIGJlIHJlYWQgaW4gdGhlIHN0cmVhbSAob3B0aW9uYWwsIGlmIG5vdCBzcGVjaWZpZWQgd2UgcmVhZCB0aGUgcmVzdCBvZiB0aGUgZmlsZSBmcm9tIHRoZSBvZmZzZXQpXG4gICAqIEBwYXJhbSBnZXRPcHRzXG4gICAqL1xuICBhc3luYyBnZXRQYXJ0aWFsT2JqZWN0KFxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICBvYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgb2Zmc2V0OiBudW1iZXIsXG4gICAgbGVuZ3RoID0gMCxcbiAgICBnZXRPcHRzOiBWZXJzaW9uSWRlbnRpZmljYXRvciA9IHt9LFxuICApOiBQcm9taXNlPHN0cmVhbS5SZWFkYWJsZT4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNOdW1iZXIob2Zmc2V0KSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignb2Zmc2V0IHNob3VsZCBiZSBvZiB0eXBlIFwibnVtYmVyXCInKVxuICAgIH1cbiAgICBpZiAoIWlzTnVtYmVyKGxlbmd0aCkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2xlbmd0aCBzaG91bGQgYmUgb2YgdHlwZSBcIm51bWJlclwiJylcbiAgICB9XG5cbiAgICBsZXQgcmFuZ2UgPSAnJ1xuICAgIGlmIChvZmZzZXQgfHwgbGVuZ3RoKSB7XG4gICAgICBpZiAob2Zmc2V0KSB7XG4gICAgICAgIHJhbmdlID0gYGJ5dGVzPSR7K29mZnNldH0tYFxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmFuZ2UgPSAnYnl0ZXM9MC0nXG4gICAgICAgIG9mZnNldCA9IDBcbiAgICAgIH1cbiAgICAgIGlmIChsZW5ndGgpIHtcbiAgICAgICAgcmFuZ2UgKz0gYCR7K2xlbmd0aCArIG9mZnNldCAtIDF9YFxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IGhlYWRlcnM6IFJlcXVlc3RIZWFkZXJzID0ge31cbiAgICBpZiAocmFuZ2UgIT09ICcnKSB7XG4gICAgICBoZWFkZXJzLnJhbmdlID0gcmFuZ2VcbiAgICB9XG5cbiAgICBjb25zdCBleHBlY3RlZFN0YXR1c0NvZGVzID0gWzIwMF1cbiAgICBpZiAocmFuZ2UpIHtcbiAgICAgIGV4cGVjdGVkU3RhdHVzQ29kZXMucHVzaCgyMDYpXG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG5cbiAgICBjb25zdCBxdWVyeSA9IHFzLnN0cmluZ2lmeShnZXRPcHRzKVxuICAgIHJldHVybiBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGhlYWRlcnMsIHF1ZXJ5IH0sICcnLCBleHBlY3RlZFN0YXR1c0NvZGVzKVxuICB9XG5cbiAgLyoqXG4gICAqIGRvd25sb2FkIG9iamVjdCBjb250ZW50IHRvIGEgZmlsZS5cbiAgICogVGhpcyBtZXRob2Qgd2lsbCBjcmVhdGUgYSB0ZW1wIGZpbGUgbmFtZWQgYCR7ZmlsZW5hbWV9LiR7ZXRhZ30ucGFydC5taW5pb2Agd2hlbiBkb3dubG9hZGluZy5cbiAgICpcbiAgICogQHBhcmFtIGJ1Y2tldE5hbWUgLSBuYW1lIG9mIHRoZSBidWNrZXRcbiAgICogQHBhcmFtIG9iamVjdE5hbWUgLSBuYW1lIG9mIHRoZSBvYmplY3RcbiAgICogQHBhcmFtIGZpbGVQYXRoIC0gcGF0aCB0byB3aGljaCB0aGUgb2JqZWN0IGRhdGEgd2lsbCBiZSB3cml0dGVuIHRvXG4gICAqIEBwYXJhbSBnZXRPcHRzIC0gT3B0aW9uYWwgb2JqZWN0IGdldCBvcHRpb25cbiAgICovXG4gIGFzeW5jIGZHZXRPYmplY3QoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIGZpbGVQYXRoOiBzdHJpbmcsIGdldE9wdHM6IFZlcnNpb25JZGVudGlmaWNhdG9yID0ge30pIHtcbiAgICAvLyBJbnB1dCB2YWxpZGF0aW9uLlxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcoZmlsZVBhdGgpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdmaWxlUGF0aCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG5cbiAgICBjb25zdCBkb3dubG9hZFRvVG1wRmlsZSA9IGFzeW5jICgpOiBQcm9taXNlPHN0cmluZz4gPT4ge1xuICAgICAgbGV0IHBhcnRGaWxlU3RyZWFtOiBzdHJlYW0uV3JpdGFibGVcbiAgICAgIGNvbnN0IG9ialN0YXQgPSBhd2FpdCB0aGlzLnN0YXRPYmplY3QoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgZ2V0T3B0cylcbiAgICAgIGNvbnN0IHBhcnRGaWxlID0gYCR7ZmlsZVBhdGh9LiR7b2JqU3RhdC5ldGFnfS5wYXJ0Lm1pbmlvYFxuXG4gICAgICBhd2FpdCBmc3AubWtkaXIocGF0aC5kaXJuYW1lKGZpbGVQYXRoKSwgeyByZWN1cnNpdmU6IHRydWUgfSlcblxuICAgICAgbGV0IG9mZnNldCA9IDBcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHN0YXRzID0gYXdhaXQgZnNwLnN0YXQocGFydEZpbGUpXG4gICAgICAgIGlmIChvYmpTdGF0LnNpemUgPT09IHN0YXRzLnNpemUpIHtcbiAgICAgICAgICByZXR1cm4gcGFydEZpbGVcbiAgICAgICAgfVxuICAgICAgICBvZmZzZXQgPSBzdGF0cy5zaXplXG4gICAgICAgIHBhcnRGaWxlU3RyZWFtID0gZnMuY3JlYXRlV3JpdGVTdHJlYW0ocGFydEZpbGUsIHsgZmxhZ3M6ICdhJyB9KVxuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBpZiAoZSBpbnN0YW5jZW9mIEVycm9yICYmIChlIGFzIHVua25vd24gYXMgeyBjb2RlOiBzdHJpbmcgfSkuY29kZSA9PT0gJ0VOT0VOVCcpIHtcbiAgICAgICAgICAvLyBmaWxlIG5vdCBleGlzdFxuICAgICAgICAgIHBhcnRGaWxlU3RyZWFtID0gZnMuY3JlYXRlV3JpdGVTdHJlYW0ocGFydEZpbGUsIHsgZmxhZ3M6ICd3JyB9KVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIG90aGVyIGVycm9yLCBtYXliZSBhY2Nlc3MgZGVueVxuICAgICAgICAgIHRocm93IGVcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjb25zdCBkb3dubG9hZFN0cmVhbSA9IGF3YWl0IHRoaXMuZ2V0UGFydGlhbE9iamVjdChidWNrZXROYW1lLCBvYmplY3ROYW1lLCBvZmZzZXQsIDAsIGdldE9wdHMpXG5cbiAgICAgIGF3YWl0IHN0cmVhbVByb21pc2UucGlwZWxpbmUoZG93bmxvYWRTdHJlYW0sIHBhcnRGaWxlU3RyZWFtKVxuICAgICAgY29uc3Qgc3RhdHMgPSBhd2FpdCBmc3Auc3RhdChwYXJ0RmlsZSlcbiAgICAgIGlmIChzdGF0cy5zaXplID09PSBvYmpTdGF0LnNpemUpIHtcbiAgICAgICAgcmV0dXJuIHBhcnRGaWxlXG4gICAgICB9XG5cbiAgICAgIHRocm93IG5ldyBFcnJvcignU2l6ZSBtaXNtYXRjaCBiZXR3ZWVuIGRvd25sb2FkZWQgZmlsZSBhbmQgdGhlIG9iamVjdCcpXG4gICAgfVxuXG4gICAgY29uc3QgcGFydEZpbGUgPSBhd2FpdCBkb3dubG9hZFRvVG1wRmlsZSgpXG4gICAgYXdhaXQgZnNwLnJlbmFtZShwYXJ0RmlsZSwgZmlsZVBhdGgpXG4gIH1cblxuICAvKipcbiAgICogU3RhdCBpbmZvcm1hdGlvbiBvZiB0aGUgb2JqZWN0LlxuICAgKi9cbiAgYXN5bmMgc3RhdE9iamVjdChidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgc3RhdE9wdHM6IFN0YXRPYmplY3RPcHRzID0ge30pOiBQcm9taXNlPEJ1Y2tldEl0ZW1TdGF0PiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG5cbiAgICBpZiAoIWlzT2JqZWN0KHN0YXRPcHRzKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignc3RhdE9wdHMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuXG4gICAgY29uc3QgcXVlcnkgPSBxcy5zdHJpbmdpZnkoc3RhdE9wdHMpXG4gICAgY29uc3QgbWV0aG9kID0gJ0hFQUQnXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnkgfSlcblxuICAgIHJldHVybiB7XG4gICAgICBzaXplOiBwYXJzZUludChyZXMuaGVhZGVyc1snY29udGVudC1sZW5ndGgnXSBhcyBzdHJpbmcpLFxuICAgICAgbWV0YURhdGE6IGV4dHJhY3RNZXRhZGF0YShyZXMuaGVhZGVycyBhcyBSZXNwb25zZUhlYWRlciksXG4gICAgICBsYXN0TW9kaWZpZWQ6IG5ldyBEYXRlKHJlcy5oZWFkZXJzWydsYXN0LW1vZGlmaWVkJ10gYXMgc3RyaW5nKSxcbiAgICAgIHZlcnNpb25JZDogZ2V0VmVyc2lvbklkKHJlcy5oZWFkZXJzIGFzIFJlc3BvbnNlSGVhZGVyKSxcbiAgICAgIGV0YWc6IHNhbml0aXplRVRhZyhyZXMuaGVhZGVycy5ldGFnKSxcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVtb3ZlIHRoZSBzcGVjaWZpZWQgb2JqZWN0LlxuICAgKiBAZGVwcmVjYXRlZCB1c2UgbmV3IHByb21pc2Ugc3R5bGUgQVBJXG4gICAqL1xuICByZW1vdmVPYmplY3QoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIHJlbW92ZU9wdHM6IFJlbW92ZU9wdGlvbnMsIGNhbGxiYWNrOiBOb1Jlc3VsdENhbGxiYWNrKTogdm9pZFxuICAvKipcbiAgICogQGRlcHJlY2F0ZWQgdXNlIG5ldyBwcm9taXNlIHN0eWxlIEFQSVxuICAgKi9cbiAgLy8gQHRzLWlnbm9yZVxuICByZW1vdmVPYmplY3QoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIGNhbGxiYWNrOiBOb1Jlc3VsdENhbGxiYWNrKTogdm9pZFxuICBhc3luYyByZW1vdmVPYmplY3QoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIHJlbW92ZU9wdHM/OiBSZW1vdmVPcHRpb25zKTogUHJvbWlzZTx2b2lkPlxuXG4gIGFzeW5jIHJlbW92ZU9iamVjdChidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgcmVtb3ZlT3B0czogUmVtb3ZlT3B0aW9ucyA9IHt9KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKGBJbnZhbGlkIGJ1Y2tldCBuYW1lOiAke2J1Y2tldE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG5cbiAgICBpZiAoIWlzT2JqZWN0KHJlbW92ZU9wdHMpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdyZW1vdmVPcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdERUxFVEUnXG5cbiAgICBjb25zdCBoZWFkZXJzOiBSZXF1ZXN0SGVhZGVycyA9IHt9XG4gICAgaWYgKHJlbW92ZU9wdHMuZ292ZXJuYW5jZUJ5cGFzcykge1xuICAgICAgaGVhZGVyc1snWC1BbXotQnlwYXNzLUdvdmVybmFuY2UtUmV0ZW50aW9uJ10gPSB0cnVlXG4gICAgfVxuICAgIGlmIChyZW1vdmVPcHRzLmZvcmNlRGVsZXRlKSB7XG4gICAgICBoZWFkZXJzWyd4LW1pbmlvLWZvcmNlLWRlbGV0ZSddID0gdHJ1ZVxuICAgIH1cblxuICAgIGNvbnN0IHF1ZXJ5UGFyYW1zOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge31cbiAgICBpZiAocmVtb3ZlT3B0cy52ZXJzaW9uSWQpIHtcbiAgICAgIHF1ZXJ5UGFyYW1zLnZlcnNpb25JZCA9IGAke3JlbW92ZU9wdHMudmVyc2lvbklkfWBcbiAgICB9XG4gICAgY29uc3QgcXVlcnkgPSBxcy5zdHJpbmdpZnkocXVlcnlQYXJhbXMpXG5cbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBoZWFkZXJzLCBxdWVyeSB9LCAnJywgWzIwMCwgMjA0XSlcbiAgfVxuXG4gIC8vIENhbGxzIGltcGxlbWVudGVkIGJlbG93IGFyZSByZWxhdGVkIHRvIG11bHRpcGFydC5cblxuICBsaXN0SW5jb21wbGV0ZVVwbG9hZHMoXG4gICAgYnVja2V0OiBzdHJpbmcsXG4gICAgcHJlZml4OiBzdHJpbmcsXG4gICAgcmVjdXJzaXZlOiBib29sZWFuLFxuICApOiBCdWNrZXRTdHJlYW08SW5jb21wbGV0ZVVwbG9hZGVkQnVja2V0SXRlbT4ge1xuICAgIGlmIChwcmVmaXggPT09IHVuZGVmaW5lZCkge1xuICAgICAgcHJlZml4ID0gJydcbiAgICB9XG4gICAgaWYgKHJlY3Vyc2l2ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICByZWN1cnNpdmUgPSBmYWxzZVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldCkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldClcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkUHJlZml4KHByZWZpeCkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZFByZWZpeEVycm9yKGBJbnZhbGlkIHByZWZpeCA6ICR7cHJlZml4fWApXG4gICAgfVxuICAgIGlmICghaXNCb29sZWFuKHJlY3Vyc2l2ZSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3JlY3Vyc2l2ZSBzaG91bGQgYmUgb2YgdHlwZSBcImJvb2xlYW5cIicpXG4gICAgfVxuICAgIGNvbnN0IGRlbGltaXRlciA9IHJlY3Vyc2l2ZSA/ICcnIDogJy8nXG4gICAgbGV0IGtleU1hcmtlciA9ICcnXG4gICAgbGV0IHVwbG9hZElkTWFya2VyID0gJydcbiAgICBjb25zdCB1cGxvYWRzOiB1bmtub3duW10gPSBbXVxuICAgIGxldCBlbmRlZCA9IGZhbHNlXG5cbiAgICAvLyBUT0RPOiByZWZhY3RvciB0aGlzIHdpdGggYXN5bmMvYXdhaXQgYW5kIGBzdHJlYW0uUmVhZGFibGUuZnJvbWBcbiAgICBjb25zdCByZWFkU3RyZWFtID0gbmV3IHN0cmVhbS5SZWFkYWJsZSh7IG9iamVjdE1vZGU6IHRydWUgfSlcbiAgICByZWFkU3RyZWFtLl9yZWFkID0gKCkgPT4ge1xuICAgICAgLy8gcHVzaCBvbmUgdXBsb2FkIGluZm8gcGVyIF9yZWFkKClcbiAgICAgIGlmICh1cGxvYWRzLmxlbmd0aCkge1xuICAgICAgICByZXR1cm4gcmVhZFN0cmVhbS5wdXNoKHVwbG9hZHMuc2hpZnQoKSlcbiAgICAgIH1cbiAgICAgIGlmIChlbmRlZCkge1xuICAgICAgICByZXR1cm4gcmVhZFN0cmVhbS5wdXNoKG51bGwpXG4gICAgICB9XG4gICAgICB0aGlzLmxpc3RJbmNvbXBsZXRlVXBsb2Fkc1F1ZXJ5KGJ1Y2tldCwgcHJlZml4LCBrZXlNYXJrZXIsIHVwbG9hZElkTWFya2VyLCBkZWxpbWl0ZXIpLnRoZW4oXG4gICAgICAgIChyZXN1bHQpID0+IHtcbiAgICAgICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L2Jhbi10cy1jb21tZW50XG4gICAgICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgICAgIHJlc3VsdC5wcmVmaXhlcy5mb3JFYWNoKChwcmVmaXgpID0+IHVwbG9hZHMucHVzaChwcmVmaXgpKVxuICAgICAgICAgIGFzeW5jLmVhY2hTZXJpZXMoXG4gICAgICAgICAgICByZXN1bHQudXBsb2FkcyxcbiAgICAgICAgICAgICh1cGxvYWQsIGNiKSA9PiB7XG4gICAgICAgICAgICAgIC8vIGZvciBlYWNoIGluY29tcGxldGUgdXBsb2FkIGFkZCB0aGUgc2l6ZXMgb2YgaXRzIHVwbG9hZGVkIHBhcnRzXG4gICAgICAgICAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvYmFuLXRzLWNvbW1lbnRcbiAgICAgICAgICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgICAgICAgICB0aGlzLmxpc3RQYXJ0cyhidWNrZXQsIHVwbG9hZC5rZXksIHVwbG9hZC51cGxvYWRJZCkudGhlbihcbiAgICAgICAgICAgICAgICAocGFydHM6IFBhcnRbXSkgPT4ge1xuICAgICAgICAgICAgICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9iYW4tdHMtY29tbWVudFxuICAgICAgICAgICAgICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgICAgICAgICAgICAgdXBsb2FkLnNpemUgPSBwYXJ0cy5yZWR1Y2UoKGFjYywgaXRlbSkgPT4gYWNjICsgaXRlbS5zaXplLCAwKVxuICAgICAgICAgICAgICAgICAgdXBsb2Fkcy5wdXNoKHVwbG9hZClcbiAgICAgICAgICAgICAgICAgIGNiKClcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIChlcnI6IEVycm9yKSA9PiBjYihlcnIpLFxuICAgICAgICAgICAgICApXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgKGVycikgPT4ge1xuICAgICAgICAgICAgICBpZiAoZXJyKSB7XG4gICAgICAgICAgICAgICAgcmVhZFN0cmVhbS5lbWl0KCdlcnJvcicsIGVycilcbiAgICAgICAgICAgICAgICByZXR1cm5cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBpZiAocmVzdWx0LmlzVHJ1bmNhdGVkKSB7XG4gICAgICAgICAgICAgICAga2V5TWFya2VyID0gcmVzdWx0Lm5leHRLZXlNYXJrZXJcbiAgICAgICAgICAgICAgICB1cGxvYWRJZE1hcmtlciA9IHJlc3VsdC5uZXh0VXBsb2FkSWRNYXJrZXJcbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBlbmRlZCA9IHRydWVcbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvYmFuLXRzLWNvbW1lbnRcbiAgICAgICAgICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgICAgICAgICByZWFkU3RyZWFtLl9yZWFkKClcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgKVxuICAgICAgICB9LFxuICAgICAgICAoZSkgPT4ge1xuICAgICAgICAgIHJlYWRTdHJlYW0uZW1pdCgnZXJyb3InLCBlKVxuICAgICAgICB9LFxuICAgICAgKVxuICAgIH1cbiAgICByZXR1cm4gcmVhZFN0cmVhbVxuICB9XG5cbiAgLyoqXG4gICAqIENhbGxlZCBieSBsaXN0SW5jb21wbGV0ZVVwbG9hZHMgdG8gZmV0Y2ggYSBiYXRjaCBvZiBpbmNvbXBsZXRlIHVwbG9hZHMuXG4gICAqL1xuICBhc3luYyBsaXN0SW5jb21wbGV0ZVVwbG9hZHNRdWVyeShcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXG4gICAgcHJlZml4OiBzdHJpbmcsXG4gICAga2V5TWFya2VyOiBzdHJpbmcsXG4gICAgdXBsb2FkSWRNYXJrZXI6IHN0cmluZyxcbiAgICBkZWxpbWl0ZXI6IHN0cmluZyxcbiAgKTogUHJvbWlzZTxMaXN0TXVsdGlwYXJ0UmVzdWx0PiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhwcmVmaXgpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdwcmVmaXggc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcoa2V5TWFya2VyKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigna2V5TWFya2VyIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHVwbG9hZElkTWFya2VyKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigndXBsb2FkSWRNYXJrZXIgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcoZGVsaW1pdGVyKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignZGVsaW1pdGVyIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBjb25zdCBxdWVyaWVzID0gW11cbiAgICBxdWVyaWVzLnB1c2goYHByZWZpeD0ke3VyaUVzY2FwZShwcmVmaXgpfWApXG4gICAgcXVlcmllcy5wdXNoKGBkZWxpbWl0ZXI9JHt1cmlFc2NhcGUoZGVsaW1pdGVyKX1gKVxuXG4gICAgaWYgKGtleU1hcmtlcikge1xuICAgICAgcXVlcmllcy5wdXNoKGBrZXktbWFya2VyPSR7dXJpRXNjYXBlKGtleU1hcmtlcil9YClcbiAgICB9XG4gICAgaWYgKHVwbG9hZElkTWFya2VyKSB7XG4gICAgICBxdWVyaWVzLnB1c2goYHVwbG9hZC1pZC1tYXJrZXI9JHt1cGxvYWRJZE1hcmtlcn1gKVxuICAgIH1cblxuICAgIGNvbnN0IG1heFVwbG9hZHMgPSAxMDAwXG4gICAgcXVlcmllcy5wdXNoKGBtYXgtdXBsb2Fkcz0ke21heFVwbG9hZHN9YClcbiAgICBxdWVyaWVzLnNvcnQoKVxuICAgIHF1ZXJpZXMudW5zaGlmdCgndXBsb2FkcycpXG4gICAgbGV0IHF1ZXJ5ID0gJydcbiAgICBpZiAocXVlcmllcy5sZW5ndGggPiAwKSB7XG4gICAgICBxdWVyeSA9IGAke3F1ZXJpZXMuam9pbignJicpfWBcbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0pXG4gICAgY29uc3QgYm9keSA9IGF3YWl0IHJlYWRBc1N0cmluZyhyZXMpXG4gICAgcmV0dXJuIHhtbFBhcnNlcnMucGFyc2VMaXN0TXVsdGlwYXJ0KGJvZHkpXG4gIH1cblxuICAvKipcbiAgICogSW5pdGlhdGUgYSBuZXcgbXVsdGlwYXJ0IHVwbG9hZC5cbiAgICogQGludGVybmFsXG4gICAqL1xuICBhc3luYyBpbml0aWF0ZU5ld011bHRpcGFydFVwbG9hZChidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgaGVhZGVyczogUmVxdWVzdEhlYWRlcnMpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNPYmplY3QoaGVhZGVycykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcignY29udGVudFR5cGUgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdQT1NUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ3VwbG9hZHMnXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSwgaGVhZGVycyB9KVxuICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNCdWZmZXIocmVzKVxuICAgIHJldHVybiBwYXJzZUluaXRpYXRlTXVsdGlwYXJ0KGJvZHkudG9TdHJpbmcoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBJbnRlcm5hbCBNZXRob2QgdG8gYWJvcnQgYSBtdWx0aXBhcnQgdXBsb2FkIHJlcXVlc3QgaW4gY2FzZSBvZiBhbnkgZXJyb3JzLlxuICAgKlxuICAgKiBAcGFyYW0gYnVja2V0TmFtZSAtIEJ1Y2tldCBOYW1lXG4gICAqIEBwYXJhbSBvYmplY3ROYW1lIC0gT2JqZWN0IE5hbWVcbiAgICogQHBhcmFtIHVwbG9hZElkIC0gaWQgb2YgYSBtdWx0aXBhcnQgdXBsb2FkIHRvIGNhbmNlbCBkdXJpbmcgY29tcG9zZSBvYmplY3Qgc2VxdWVuY2UuXG4gICAqL1xuICBhc3luYyBhYm9ydE11bHRpcGFydFVwbG9hZChidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgdXBsb2FkSWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG1ldGhvZCA9ICdERUxFVEUnXG4gICAgY29uc3QgcXVlcnkgPSBgdXBsb2FkSWQ9JHt1cGxvYWRJZH1gXG5cbiAgICBjb25zdCByZXF1ZXN0T3B0aW9ucyA9IHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lOiBvYmplY3ROYW1lLCBxdWVyeSB9XG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdChyZXF1ZXN0T3B0aW9ucywgJycsIFsyMDRdKVxuICB9XG5cbiAgYXN5bmMgZmluZFVwbG9hZElkKGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmcgfCB1bmRlZmluZWQ+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cblxuICAgIGxldCBsYXRlc3RVcGxvYWQ6IExpc3RNdWx0aXBhcnRSZXN1bHRbJ3VwbG9hZHMnXVtudW1iZXJdIHwgdW5kZWZpbmVkXG4gICAgbGV0IGtleU1hcmtlciA9ICcnXG4gICAgbGV0IHVwbG9hZElkTWFya2VyID0gJydcbiAgICBmb3IgKDs7KSB7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmxpc3RJbmNvbXBsZXRlVXBsb2Fkc1F1ZXJ5KGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGtleU1hcmtlciwgdXBsb2FkSWRNYXJrZXIsICcnKVxuICAgICAgZm9yIChjb25zdCB1cGxvYWQgb2YgcmVzdWx0LnVwbG9hZHMpIHtcbiAgICAgICAgaWYgKHVwbG9hZC5rZXkgPT09IG9iamVjdE5hbWUpIHtcbiAgICAgICAgICBpZiAoIWxhdGVzdFVwbG9hZCB8fCB1cGxvYWQuaW5pdGlhdGVkLmdldFRpbWUoKSA+IGxhdGVzdFVwbG9hZC5pbml0aWF0ZWQuZ2V0VGltZSgpKSB7XG4gICAgICAgICAgICBsYXRlc3RVcGxvYWQgPSB1cGxvYWRcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChyZXN1bHQuaXNUcnVuY2F0ZWQpIHtcbiAgICAgICAga2V5TWFya2VyID0gcmVzdWx0Lm5leHRLZXlNYXJrZXJcbiAgICAgICAgdXBsb2FkSWRNYXJrZXIgPSByZXN1bHQubmV4dFVwbG9hZElkTWFya2VyXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGJyZWFrXG4gICAgfVxuICAgIHJldHVybiBsYXRlc3RVcGxvYWQ/LnVwbG9hZElkXG4gIH1cblxuICAvKipcbiAgICogdGhpcyBjYWxsIHdpbGwgYWdncmVnYXRlIHRoZSBwYXJ0cyBvbiB0aGUgc2VydmVyIGludG8gYSBzaW5nbGUgb2JqZWN0LlxuICAgKi9cbiAgYXN5bmMgY29tcGxldGVNdWx0aXBhcnRVcGxvYWQoXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxuICAgIG9iamVjdE5hbWU6IHN0cmluZyxcbiAgICB1cGxvYWRJZDogc3RyaW5nLFxuICAgIGV0YWdzOiB7XG4gICAgICBwYXJ0OiBudW1iZXJcbiAgICAgIGV0YWc/OiBzdHJpbmdcbiAgICB9W10sXG4gICk6IFByb21pc2U8eyBldGFnOiBzdHJpbmc7IHZlcnNpb25JZDogc3RyaW5nIHwgbnVsbCB9PiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyh1cGxvYWRJZCkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3VwbG9hZElkIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoIWlzT2JqZWN0KGV0YWdzKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignZXRhZ3Mgc2hvdWxkIGJlIG9mIHR5cGUgXCJBcnJheVwiJylcbiAgICB9XG5cbiAgICBpZiAoIXVwbG9hZElkKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCd1cGxvYWRJZCBjYW5ub3QgYmUgZW1wdHknKVxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdQT1NUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gYHVwbG9hZElkPSR7dXJpRXNjYXBlKHVwbG9hZElkKX1gXG5cbiAgICBjb25zdCBidWlsZGVyID0gbmV3IHhtbDJqcy5CdWlsZGVyKClcbiAgICBjb25zdCBwYXlsb2FkID0gYnVpbGRlci5idWlsZE9iamVjdCh7XG4gICAgICBDb21wbGV0ZU11bHRpcGFydFVwbG9hZDoge1xuICAgICAgICAkOiB7XG4gICAgICAgICAgeG1sbnM6ICdodHRwOi8vczMuYW1hem9uYXdzLmNvbS9kb2MvMjAwNi0wMy0wMS8nLFxuICAgICAgICB9LFxuICAgICAgICBQYXJ0OiBldGFncy5tYXAoKGV0YWcpID0+IHtcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgUGFydE51bWJlcjogZXRhZy5wYXJ0LFxuICAgICAgICAgICAgRVRhZzogZXRhZy5ldGFnLFxuICAgICAgICAgIH1cbiAgICAgICAgfSksXG4gICAgICB9LFxuICAgIH0pXG5cbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHF1ZXJ5IH0sIHBheWxvYWQpXG4gICAgY29uc3QgYm9keSA9IGF3YWl0IHJlYWRBc0J1ZmZlcihyZXMpXG4gICAgY29uc3QgcmVzdWx0ID0gcGFyc2VDb21wbGV0ZU11bHRpcGFydChib2R5LnRvU3RyaW5nKCkpXG4gICAgaWYgKCFyZXN1bHQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignQlVHOiBmYWlsZWQgdG8gcGFyc2Ugc2VydmVyIHJlc3BvbnNlJylcbiAgICB9XG5cbiAgICBpZiAocmVzdWx0LmVyckNvZGUpIHtcbiAgICAgIC8vIE11bHRpcGFydCBDb21wbGV0ZSBBUEkgcmV0dXJucyBhbiBlcnJvciBYTUwgYWZ0ZXIgYSAyMDAgaHR0cCBzdGF0dXNcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuUzNFcnJvcihyZXN1bHQuZXJyTWVzc2FnZSlcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9iYW4tdHMtY29tbWVudFxuICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgZXRhZzogcmVzdWx0LmV0YWcgYXMgc3RyaW5nLFxuICAgICAgdmVyc2lvbklkOiBnZXRWZXJzaW9uSWQocmVzLmhlYWRlcnMgYXMgUmVzcG9uc2VIZWFkZXIpLFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgcGFydC1pbmZvIG9mIGFsbCBwYXJ0cyBvZiBhbiBpbmNvbXBsZXRlIHVwbG9hZCBzcGVjaWZpZWQgYnkgdXBsb2FkSWQuXG4gICAqL1xuICBwcm90ZWN0ZWQgYXN5bmMgbGlzdFBhcnRzKGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nLCB1cGxvYWRJZDogc3RyaW5nKTogUHJvbWlzZTxVcGxvYWRlZFBhcnRbXT4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcodXBsb2FkSWQpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCd1cGxvYWRJZCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKCF1cGxvYWRJZCkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigndXBsb2FkSWQgY2Fubm90IGJlIGVtcHR5JylcbiAgICB9XG5cbiAgICBjb25zdCBwYXJ0czogVXBsb2FkZWRQYXJ0W10gPSBbXVxuICAgIGxldCBtYXJrZXIgPSAwXG4gICAgbGV0IHJlc3VsdFxuICAgIGRvIHtcbiAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMubGlzdFBhcnRzUXVlcnkoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgdXBsb2FkSWQsIG1hcmtlcilcbiAgICAgIG1hcmtlciA9IHJlc3VsdC5tYXJrZXJcbiAgICAgIHBhcnRzLnB1c2goLi4ucmVzdWx0LnBhcnRzKVxuICAgIH0gd2hpbGUgKHJlc3VsdC5pc1RydW5jYXRlZClcblxuICAgIHJldHVybiBwYXJ0c1xuICB9XG5cbiAgLyoqXG4gICAqIENhbGxlZCBieSBsaXN0UGFydHMgdG8gZmV0Y2ggYSBiYXRjaCBvZiBwYXJ0LWluZm9cbiAgICovXG4gIHByaXZhdGUgYXN5bmMgbGlzdFBhcnRzUXVlcnkoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIHVwbG9hZElkOiBzdHJpbmcsIG1hcmtlcjogbnVtYmVyKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyh1cGxvYWRJZCkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3VwbG9hZElkIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoIWlzTnVtYmVyKG1hcmtlcikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ21hcmtlciBzaG91bGQgYmUgb2YgdHlwZSBcIm51bWJlclwiJylcbiAgICB9XG4gICAgaWYgKCF1cGxvYWRJZCkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigndXBsb2FkSWQgY2Fubm90IGJlIGVtcHR5JylcbiAgICB9XG5cbiAgICBsZXQgcXVlcnkgPSBgdXBsb2FkSWQ9JHt1cmlFc2NhcGUodXBsb2FkSWQpfWBcbiAgICBpZiAobWFya2VyKSB7XG4gICAgICBxdWVyeSArPSBgJnBhcnQtbnVtYmVyLW1hcmtlcj0ke21hcmtlcn1gXG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHF1ZXJ5IH0pXG4gICAgcmV0dXJuIHhtbFBhcnNlcnMucGFyc2VMaXN0UGFydHMoYXdhaXQgcmVhZEFzU3RyaW5nKHJlcykpXG4gIH1cblxuICBhc3luYyBsaXN0QnVja2V0cygpOiBQcm9taXNlPEJ1Y2tldEl0ZW1Gcm9tTGlzdFtdPiB7XG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcbiAgICBjb25zdCBodHRwUmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kIH0sICcnLCBbMjAwXSwgREVGQVVMVF9SRUdJT04pXG4gICAgY29uc3QgeG1sUmVzdWx0ID0gYXdhaXQgcmVhZEFzU3RyaW5nKGh0dHBSZXMpXG4gICAgcmV0dXJuIHhtbFBhcnNlcnMucGFyc2VMaXN0QnVja2V0KHhtbFJlc3VsdClcbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxjdWxhdGUgcGFydCBzaXplIGdpdmVuIHRoZSBvYmplY3Qgc2l6ZS4gUGFydCBzaXplIHdpbGwgYmUgYXRsZWFzdCB0aGlzLnBhcnRTaXplXG4gICAqL1xuICBjYWxjdWxhdGVQYXJ0U2l6ZShzaXplOiBudW1iZXIpIHtcbiAgICBpZiAoIWlzTnVtYmVyKHNpemUpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdzaXplIHNob3VsZCBiZSBvZiB0eXBlIFwibnVtYmVyXCInKVxuICAgIH1cbiAgICBpZiAoc2l6ZSA+IHRoaXMubWF4T2JqZWN0U2l6ZSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgc2l6ZSBzaG91bGQgbm90IGJlIG1vcmUgdGhhbiAke3RoaXMubWF4T2JqZWN0U2l6ZX1gKVxuICAgIH1cbiAgICBpZiAodGhpcy5vdmVyUmlkZVBhcnRTaXplKSB7XG4gICAgICByZXR1cm4gdGhpcy5wYXJ0U2l6ZVxuICAgIH1cbiAgICBsZXQgcGFydFNpemUgPSB0aGlzLnBhcnRTaXplXG4gICAgZm9yICg7Oykge1xuICAgICAgLy8gd2hpbGUodHJ1ZSkgey4uLn0gdGhyb3dzIGxpbnRpbmcgZXJyb3IuXG4gICAgICAvLyBJZiBwYXJ0U2l6ZSBpcyBiaWcgZW5vdWdoIHRvIGFjY29tb2RhdGUgdGhlIG9iamVjdCBzaXplLCB0aGVuIHVzZSBpdC5cbiAgICAgIGlmIChwYXJ0U2l6ZSAqIDEwMDAwID4gc2l6ZSkge1xuICAgICAgICByZXR1cm4gcGFydFNpemVcbiAgICAgIH1cbiAgICAgIC8vIFRyeSBwYXJ0IHNpemVzIGFzIDY0TUIsIDgwTUIsIDk2TUIgZXRjLlxuICAgICAgcGFydFNpemUgKz0gMTYgKiAxMDI0ICogMTAyNFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBVcGxvYWRzIHRoZSBvYmplY3QgdXNpbmcgY29udGVudHMgZnJvbSBhIGZpbGVcbiAgICovXG4gIGFzeW5jIGZQdXRPYmplY3QoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIGZpbGVQYXRoOiBzdHJpbmcsIG1ldGFEYXRhOiBPYmplY3RNZXRhRGF0YSA9IHt9KSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG5cbiAgICBpZiAoIWlzU3RyaW5nKGZpbGVQYXRoKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignZmlsZVBhdGggc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmICghaXNPYmplY3QobWV0YURhdGEpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdtZXRhRGF0YSBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG5cbiAgICAvLyBJbnNlcnRzIGNvcnJlY3QgYGNvbnRlbnQtdHlwZWAgYXR0cmlidXRlIGJhc2VkIG9uIG1ldGFEYXRhIGFuZCBmaWxlUGF0aFxuICAgIG1ldGFEYXRhID0gaW5zZXJ0Q29udGVudFR5cGUobWV0YURhdGEsIGZpbGVQYXRoKVxuICAgIGNvbnN0IHN0YXQgPSBhd2FpdCBmc3AubHN0YXQoZmlsZVBhdGgpXG4gICAgYXdhaXQgdGhpcy5wdXRPYmplY3QoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgZnMuY3JlYXRlUmVhZFN0cmVhbShmaWxlUGF0aCksIHN0YXQuc2l6ZSwgbWV0YURhdGEpXG4gIH1cblxuICAvKipcbiAgICogIFVwbG9hZGluZyBhIHN0cmVhbSwgXCJCdWZmZXJcIiBvciBcInN0cmluZ1wiLlxuICAgKiAgSXQncyByZWNvbW1lbmRlZCB0byBwYXNzIGBzaXplYCBhcmd1bWVudCB3aXRoIHN0cmVhbS5cbiAgICovXG4gIGFzeW5jIHB1dE9iamVjdChcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXG4gICAgb2JqZWN0TmFtZTogc3RyaW5nLFxuICAgIHN0cmVhbTogc3RyZWFtLlJlYWRhYmxlIHwgQnVmZmVyIHwgc3RyaW5nLFxuICAgIHNpemU/OiBudW1iZXIsXG4gICAgbWV0YURhdGE/OiBJdGVtQnVja2V0TWV0YWRhdGEsXG4gICk6IFByb21pc2U8VXBsb2FkZWRPYmplY3RJbmZvPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKGBJbnZhbGlkIGJ1Y2tldCBuYW1lOiAke2J1Y2tldE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG5cbiAgICAvLyBXZSdsbCBuZWVkIHRvIHNoaWZ0IGFyZ3VtZW50cyB0byB0aGUgbGVmdCBiZWNhdXNlIG9mIG1ldGFEYXRhXG4gICAgLy8gYW5kIHNpemUgYmVpbmcgb3B0aW9uYWwuXG4gICAgaWYgKGlzT2JqZWN0KHNpemUpKSB7XG4gICAgICBtZXRhRGF0YSA9IHNpemVcbiAgICB9XG4gICAgLy8gRW5zdXJlcyBNZXRhZGF0YSBoYXMgYXBwcm9wcmlhdGUgcHJlZml4IGZvciBBMyBBUElcbiAgICBjb25zdCBoZWFkZXJzID0gcHJlcGVuZFhBTVpNZXRhKG1ldGFEYXRhKVxuICAgIGlmICh0eXBlb2Ygc3RyZWFtID09PSAnc3RyaW5nJyB8fCBzdHJlYW0gaW5zdGFuY2VvZiBCdWZmZXIpIHtcbiAgICAgIC8vIEFkYXB0cyB0aGUgbm9uLXN0cmVhbSBpbnRlcmZhY2UgaW50byBhIHN0cmVhbS5cbiAgICAgIHNpemUgPSBzdHJlYW0ubGVuZ3RoXG4gICAgICBzdHJlYW0gPSByZWFkYWJsZVN0cmVhbShzdHJlYW0pXG4gICAgfSBlbHNlIGlmICghaXNSZWFkYWJsZVN0cmVhbShzdHJlYW0pKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCd0aGlyZCBhcmd1bWVudCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmVhbS5SZWFkYWJsZVwiIG9yIFwiQnVmZmVyXCIgb3IgXCJzdHJpbmdcIicpXG4gICAgfVxuXG4gICAgaWYgKGlzTnVtYmVyKHNpemUpICYmIHNpemUgPCAwKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBzaXplIGNhbm5vdCBiZSBuZWdhdGl2ZSwgZ2l2ZW4gc2l6ZTogJHtzaXplfWApXG4gICAgfVxuXG4gICAgLy8gR2V0IHRoZSBwYXJ0IHNpemUgYW5kIGZvcndhcmQgdGhhdCB0byB0aGUgQmxvY2tTdHJlYW0uIERlZmF1bHQgdG8gdGhlXG4gICAgLy8gbGFyZ2VzdCBibG9jayBzaXplIHBvc3NpYmxlIGlmIG5lY2Vzc2FyeS5cbiAgICBpZiAoIWlzTnVtYmVyKHNpemUpKSB7XG4gICAgICBzaXplID0gdGhpcy5tYXhPYmplY3RTaXplXG4gICAgfVxuXG4gICAgLy8gR2V0IHRoZSBwYXJ0IHNpemUgYW5kIGZvcndhcmQgdGhhdCB0byB0aGUgQmxvY2tTdHJlYW0uIERlZmF1bHQgdG8gdGhlXG4gICAgLy8gbGFyZ2VzdCBibG9jayBzaXplIHBvc3NpYmxlIGlmIG5lY2Vzc2FyeS5cbiAgICBpZiAoc2l6ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBjb25zdCBzdGF0U2l6ZSA9IGF3YWl0IGdldENvbnRlbnRMZW5ndGgoc3RyZWFtKVxuICAgICAgaWYgKHN0YXRTaXplICE9PSBudWxsKSB7XG4gICAgICAgIHNpemUgPSBzdGF0U2l6ZVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICghaXNOdW1iZXIoc2l6ZSkpIHtcbiAgICAgIC8vIEJhY2t3YXJkIGNvbXBhdGliaWxpdHlcbiAgICAgIHNpemUgPSB0aGlzLm1heE9iamVjdFNpemVcbiAgICB9XG5cbiAgICBjb25zdCBwYXJ0U2l6ZSA9IHRoaXMuY2FsY3VsYXRlUGFydFNpemUoc2l6ZSlcbiAgICBpZiAodHlwZW9mIHN0cmVhbSA9PT0gJ3N0cmluZycgfHwgQnVmZmVyLmlzQnVmZmVyKHN0cmVhbSkgfHwgc2l6ZSA8PSBwYXJ0U2l6ZSkge1xuICAgICAgY29uc3QgYnVmID0gaXNSZWFkYWJsZVN0cmVhbShzdHJlYW0pID8gYXdhaXQgcmVhZEFzQnVmZmVyKHN0cmVhbSkgOiBCdWZmZXIuZnJvbShzdHJlYW0pXG4gICAgICByZXR1cm4gdGhpcy51cGxvYWRCdWZmZXIoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgaGVhZGVycywgYnVmKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLnVwbG9hZFN0cmVhbShidWNrZXROYW1lLCBvYmplY3ROYW1lLCBoZWFkZXJzLCBzdHJlYW0sIHBhcnRTaXplKVxuICB9XG5cbiAgLyoqXG4gICAqIG1ldGhvZCB0byB1cGxvYWQgYnVmZmVyIGluIG9uZSBjYWxsXG4gICAqIEBwcml2YXRlXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIHVwbG9hZEJ1ZmZlcihcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXG4gICAgb2JqZWN0TmFtZTogc3RyaW5nLFxuICAgIGhlYWRlcnM6IFJlcXVlc3RIZWFkZXJzLFxuICAgIGJ1ZjogQnVmZmVyLFxuICApOiBQcm9taXNlPFVwbG9hZGVkT2JqZWN0SW5mbz4ge1xuICAgIGNvbnN0IHsgbWQ1c3VtLCBzaGEyNTZzdW0gfSA9IGhhc2hCaW5hcnkoYnVmLCB0aGlzLmVuYWJsZVNIQTI1NilcbiAgICBoZWFkZXJzWydDb250ZW50LUxlbmd0aCddID0gYnVmLmxlbmd0aFxuICAgIGlmICghdGhpcy5lbmFibGVTSEEyNTYpIHtcbiAgICAgIGhlYWRlcnNbJ0NvbnRlbnQtTUQ1J10gPSBtZDVzdW1cbiAgICB9XG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdFN0cmVhbUFzeW5jKFxuICAgICAge1xuICAgICAgICBtZXRob2Q6ICdQVVQnLFxuICAgICAgICBidWNrZXROYW1lLFxuICAgICAgICBvYmplY3ROYW1lLFxuICAgICAgICBoZWFkZXJzLFxuICAgICAgfSxcbiAgICAgIGJ1ZixcbiAgICAgIHNoYTI1NnN1bSxcbiAgICAgIFsyMDBdLFxuICAgICAgJycsXG4gICAgKVxuICAgIGF3YWl0IGRyYWluUmVzcG9uc2UocmVzKVxuICAgIHJldHVybiB7XG4gICAgICBldGFnOiBzYW5pdGl6ZUVUYWcocmVzLmhlYWRlcnMuZXRhZyksXG4gICAgICB2ZXJzaW9uSWQ6IGdldFZlcnNpb25JZChyZXMuaGVhZGVycyBhcyBSZXNwb25zZUhlYWRlciksXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIHVwbG9hZCBzdHJlYW0gd2l0aCBNdWx0aXBhcnRVcGxvYWRcbiAgICogQHByaXZhdGVcbiAgICovXG4gIHByaXZhdGUgYXN5bmMgdXBsb2FkU3RyZWFtKFxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICBvYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgaGVhZGVyczogUmVxdWVzdEhlYWRlcnMsXG4gICAgYm9keTogc3RyZWFtLlJlYWRhYmxlLFxuICAgIHBhcnRTaXplOiBudW1iZXIsXG4gICk6IFByb21pc2U8VXBsb2FkZWRPYmplY3RJbmZvPiB7XG4gICAgLy8gQSBtYXAgb2YgdGhlIHByZXZpb3VzbHkgdXBsb2FkZWQgY2h1bmtzLCBmb3IgcmVzdW1pbmcgYSBmaWxlIHVwbG9hZC4gVGhpc1xuICAgIC8vIHdpbGwgYmUgbnVsbCBpZiB3ZSBhcmVuJ3QgcmVzdW1pbmcgYW4gdXBsb2FkLlxuICAgIGNvbnN0IG9sZFBhcnRzOiBSZWNvcmQ8bnVtYmVyLCBQYXJ0PiA9IHt9XG5cbiAgICAvLyBLZWVwIHRyYWNrIG9mIHRoZSBldGFncyBmb3IgYWdncmVnYXRpbmcgdGhlIGNodW5rcyB0b2dldGhlciBsYXRlci4gRWFjaFxuICAgIC8vIGV0YWcgcmVwcmVzZW50cyBhIHNpbmdsZSBjaHVuayBvZiB0aGUgZmlsZS5cbiAgICBjb25zdCBlVGFnczogUGFydFtdID0gW11cblxuICAgIGNvbnN0IHByZXZpb3VzVXBsb2FkSWQgPSBhd2FpdCB0aGlzLmZpbmRVcGxvYWRJZChidWNrZXROYW1lLCBvYmplY3ROYW1lKVxuICAgIGxldCB1cGxvYWRJZDogc3RyaW5nXG4gICAgaWYgKCFwcmV2aW91c1VwbG9hZElkKSB7XG4gICAgICB1cGxvYWRJZCA9IGF3YWl0IHRoaXMuaW5pdGlhdGVOZXdNdWx0aXBhcnRVcGxvYWQoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgaGVhZGVycylcbiAgICB9IGVsc2Uge1xuICAgICAgdXBsb2FkSWQgPSBwcmV2aW91c1VwbG9hZElkXG4gICAgICBjb25zdCBvbGRUYWdzID0gYXdhaXQgdGhpcy5saXN0UGFydHMoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcHJldmlvdXNVcGxvYWRJZClcbiAgICAgIG9sZFRhZ3MuZm9yRWFjaCgoZSkgPT4ge1xuICAgICAgICBvbGRUYWdzW2UucGFydF0gPSBlXG4gICAgICB9KVxuICAgIH1cblxuICAgIGNvbnN0IGNodW5raWVyID0gbmV3IEJsb2NrU3RyZWFtMih7IHNpemU6IHBhcnRTaXplLCB6ZXJvUGFkZGluZzogZmFsc2UgfSlcblxuICAgIGNvbnN0IFtfLCBvXSA9IGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICAgIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgYm9keS5waXBlKGNodW5raWVyKS5vbignZXJyb3InLCByZWplY3QpXG4gICAgICAgIGNodW5raWVyLm9uKCdlbmQnLCByZXNvbHZlKS5vbignZXJyb3InLCByZWplY3QpXG4gICAgICB9KSxcbiAgICAgIChhc3luYyAoKSA9PiB7XG4gICAgICAgIGxldCBwYXJ0TnVtYmVyID0gMVxuXG4gICAgICAgIGZvciBhd2FpdCAoY29uc3QgY2h1bmsgb2YgY2h1bmtpZXIpIHtcbiAgICAgICAgICBjb25zdCBtZDUgPSBjcnlwdG8uY3JlYXRlSGFzaCgnbWQ1JykudXBkYXRlKGNodW5rKS5kaWdlc3QoKVxuXG4gICAgICAgICAgY29uc3Qgb2xkUGFydCA9IG9sZFBhcnRzW3BhcnROdW1iZXJdXG4gICAgICAgICAgaWYgKG9sZFBhcnQpIHtcbiAgICAgICAgICAgIGlmIChvbGRQYXJ0LmV0YWcgPT09IG1kNS50b1N0cmluZygnaGV4JykpIHtcbiAgICAgICAgICAgICAgZVRhZ3MucHVzaCh7IHBhcnQ6IHBhcnROdW1iZXIsIGV0YWc6IG9sZFBhcnQuZXRhZyB9KVxuICAgICAgICAgICAgICBwYXJ0TnVtYmVyKytcbiAgICAgICAgICAgICAgY29udGludWVcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG5cbiAgICAgICAgICBwYXJ0TnVtYmVyKytcblxuICAgICAgICAgIC8vIG5vdyBzdGFydCB0byB1cGxvYWQgbWlzc2luZyBwYXJ0XG4gICAgICAgICAgY29uc3Qgb3B0aW9uczogUmVxdWVzdE9wdGlvbiA9IHtcbiAgICAgICAgICAgIG1ldGhvZDogJ1BVVCcsXG4gICAgICAgICAgICBxdWVyeTogcXMuc3RyaW5naWZ5KHsgcGFydE51bWJlciwgdXBsb2FkSWQgfSksXG4gICAgICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgICAgICdDb250ZW50LUxlbmd0aCc6IGNodW5rLmxlbmd0aCxcbiAgICAgICAgICAgICAgJ0NvbnRlbnQtTUQ1JzogbWQ1LnRvU3RyaW5nKCdiYXNlNjQnKSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBidWNrZXROYW1lLFxuICAgICAgICAgICAgb2JqZWN0TmFtZSxcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQob3B0aW9ucywgY2h1bmspXG5cbiAgICAgICAgICBsZXQgZXRhZyA9IHJlc3BvbnNlLmhlYWRlcnMuZXRhZ1xuICAgICAgICAgIGlmIChldGFnKSB7XG4gICAgICAgICAgICBldGFnID0gZXRhZy5yZXBsYWNlKC9eXCIvLCAnJykucmVwbGFjZSgvXCIkLywgJycpXG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGV0YWcgPSAnJ1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGVUYWdzLnB1c2goeyBwYXJ0OiBwYXJ0TnVtYmVyLCBldGFnIH0pXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5jb21wbGV0ZU11bHRpcGFydFVwbG9hZChidWNrZXROYW1lLCBvYmplY3ROYW1lLCB1cGxvYWRJZCwgZVRhZ3MpXG4gICAgICB9KSgpLFxuICAgIF0pXG5cbiAgICByZXR1cm4gb1xuICB9XG5cbiAgYXN5bmMgcmVtb3ZlQnVja2V0UmVwbGljYXRpb24oYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPlxuICByZW1vdmVCdWNrZXRSZXBsaWNhdGlvbihidWNrZXROYW1lOiBzdHJpbmcsIGNhbGxiYWNrOiBOb1Jlc3VsdENhbGxiYWNrKTogdm9pZFxuICBhc3luYyByZW1vdmVCdWNrZXRSZXBsaWNhdGlvbihidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnREVMRVRFJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ3JlcGxpY2F0aW9uJ1xuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0sICcnLCBbMjAwLCAyMDRdLCAnJylcbiAgfVxuXG4gIHNldEJ1Y2tldFJlcGxpY2F0aW9uKGJ1Y2tldE5hbWU6IHN0cmluZywgcmVwbGljYXRpb25Db25maWc6IFJlcGxpY2F0aW9uQ29uZmlnT3B0cyk6IHZvaWRcbiAgYXN5bmMgc2V0QnVja2V0UmVwbGljYXRpb24oYnVja2V0TmFtZTogc3RyaW5nLCByZXBsaWNhdGlvbkNvbmZpZzogUmVwbGljYXRpb25Db25maWdPcHRzKTogUHJvbWlzZTx2b2lkPlxuICBhc3luYyBzZXRCdWNrZXRSZXBsaWNhdGlvbihidWNrZXROYW1lOiBzdHJpbmcsIHJlcGxpY2F0aW9uQ29uZmlnOiBSZXBsaWNhdGlvbkNvbmZpZ09wdHMpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzT2JqZWN0KHJlcGxpY2F0aW9uQ29uZmlnKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigncmVwbGljYXRpb25Db25maWcgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfSBlbHNlIHtcbiAgICAgIGlmIChfLmlzRW1wdHkocmVwbGljYXRpb25Db25maWcucm9sZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignUm9sZSBjYW5ub3QgYmUgZW1wdHknKVxuICAgICAgfSBlbHNlIGlmIChyZXBsaWNhdGlvbkNvbmZpZy5yb2xlICYmICFpc1N0cmluZyhyZXBsaWNhdGlvbkNvbmZpZy5yb2xlKSkge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdJbnZhbGlkIHZhbHVlIGZvciByb2xlJywgcmVwbGljYXRpb25Db25maWcucm9sZSlcbiAgICAgIH1cbiAgICAgIGlmIChfLmlzRW1wdHkocmVwbGljYXRpb25Db25maWcucnVsZXMpKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ01pbmltdW0gb25lIHJlcGxpY2F0aW9uIHJ1bGUgbXVzdCBiZSBzcGVjaWZpZWQnKVxuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnUFVUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ3JlcGxpY2F0aW9uJ1xuICAgIGNvbnN0IGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fVxuXG4gICAgY29uc3QgcmVwbGljYXRpb25QYXJhbXNDb25maWcgPSB7XG4gICAgICBSZXBsaWNhdGlvbkNvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgUm9sZTogcmVwbGljYXRpb25Db25maWcucm9sZSxcbiAgICAgICAgUnVsZTogcmVwbGljYXRpb25Db25maWcucnVsZXMsXG4gICAgICB9LFxuICAgIH1cblxuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoeyByZW5kZXJPcHRzOiB7IHByZXR0eTogZmFsc2UgfSwgaGVhZGxlc3M6IHRydWUgfSlcbiAgICBjb25zdCBwYXlsb2FkID0gYnVpbGRlci5idWlsZE9iamVjdChyZXBsaWNhdGlvblBhcmFtc0NvbmZpZylcbiAgICBoZWFkZXJzWydDb250ZW50LU1ENSddID0gdG9NZDUocGF5bG9hZClcbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSwgaGVhZGVycyB9LCBwYXlsb2FkKVxuICB9XG5cbiAgZ2V0QnVja2V0UmVwbGljYXRpb24oYnVja2V0TmFtZTogc3RyaW5nKTogdm9pZFxuICBhc3luYyBnZXRCdWNrZXRSZXBsaWNhdGlvbihidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPFJlcGxpY2F0aW9uQ29uZmlnPlxuICBhc3luYyBnZXRCdWNrZXRSZXBsaWNhdGlvbihidWNrZXROYW1lOiBzdHJpbmcpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ3JlcGxpY2F0aW9uJ1xuXG4gICAgY29uc3QgaHR0cFJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSwgJycsIFsyMDAsIDIwNF0pXG4gICAgY29uc3QgeG1sUmVzdWx0ID0gYXdhaXQgcmVhZEFzU3RyaW5nKGh0dHBSZXMpXG4gICAgcmV0dXJuIHhtbFBhcnNlcnMucGFyc2VSZXBsaWNhdGlvbkNvbmZpZyh4bWxSZXN1bHQpXG4gIH1cblxuICBnZXRPYmplY3RMZWdhbEhvbGQoXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxuICAgIG9iamVjdE5hbWU6IHN0cmluZyxcbiAgICBnZXRPcHRzPzogR2V0T2JqZWN0TGVnYWxIb2xkT3B0aW9ucyxcbiAgICBjYWxsYmFjaz86IFJlc3VsdENhbGxiYWNrPExFR0FMX0hPTERfU1RBVFVTPixcbiAgKTogUHJvbWlzZTxMRUdBTF9IT0xEX1NUQVRVUz5cbiAgYXN5bmMgZ2V0T2JqZWN0TGVnYWxIb2xkKFxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICBvYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgZ2V0T3B0cz86IEdldE9iamVjdExlZ2FsSG9sZE9wdGlvbnMsXG4gICk6IFByb21pc2U8TEVHQUxfSE9MRF9TVEFUVVM+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cblxuICAgIGlmIChnZXRPcHRzKSB7XG4gICAgICBpZiAoIWlzT2JqZWN0KGdldE9wdHMpKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2dldE9wdHMgc2hvdWxkIGJlIG9mIHR5cGUgXCJPYmplY3RcIicpXG4gICAgICB9IGVsc2UgaWYgKE9iamVjdC5rZXlzKGdldE9wdHMpLmxlbmd0aCA+IDAgJiYgZ2V0T3B0cy52ZXJzaW9uSWQgJiYgIWlzU3RyaW5nKGdldE9wdHMudmVyc2lvbklkKSkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCd2ZXJzaW9uSWQgc2hvdWxkIGJlIG9mIHR5cGUgc3RyaW5nLjonLCBnZXRPcHRzLnZlcnNpb25JZClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGxldCBxdWVyeSA9ICdsZWdhbC1ob2xkJ1xuXG4gICAgaWYgKGdldE9wdHM/LnZlcnNpb25JZCkge1xuICAgICAgcXVlcnkgKz0gYCZ2ZXJzaW9uSWQ9JHtnZXRPcHRzLnZlcnNpb25JZH1gXG4gICAgfVxuXG4gICAgY29uc3QgaHR0cFJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnkgfSwgJycsIFsyMDBdKVxuICAgIGNvbnN0IHN0clJlcyA9IGF3YWl0IHJlYWRBc1N0cmluZyhodHRwUmVzKVxuICAgIHJldHVybiBwYXJzZU9iamVjdExlZ2FsSG9sZENvbmZpZyhzdHJSZXMpXG4gIH1cblxuICBzZXRPYmplY3RMZWdhbEhvbGQoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIHNldE9wdHM/OiBQdXRPYmplY3RMZWdhbEhvbGRPcHRpb25zKTogdm9pZFxuICBhc3luYyBzZXRPYmplY3RMZWdhbEhvbGQoXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxuICAgIG9iamVjdE5hbWU6IHN0cmluZyxcbiAgICBzZXRPcHRzID0ge1xuICAgICAgc3RhdHVzOiBMRUdBTF9IT0xEX1NUQVRVUy5FTkFCTEVELFxuICAgIH0gYXMgUHV0T2JqZWN0TGVnYWxIb2xkT3B0aW9ucyxcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG5cbiAgICBpZiAoIWlzT2JqZWN0KHNldE9wdHMpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdzZXRPcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwiT2JqZWN0XCInKVxuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoIVtMRUdBTF9IT0xEX1NUQVRVUy5FTkFCTEVELCBMRUdBTF9IT0xEX1NUQVRVUy5ESVNBQkxFRF0uaW5jbHVkZXMoc2V0T3B0cz8uc3RhdHVzKSkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdJbnZhbGlkIHN0YXR1czogJyArIHNldE9wdHMuc3RhdHVzKVxuICAgICAgfVxuICAgICAgaWYgKHNldE9wdHMudmVyc2lvbklkICYmICFzZXRPcHRzLnZlcnNpb25JZC5sZW5ndGgpIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigndmVyc2lvbklkIHNob3VsZCBiZSBvZiB0eXBlIHN0cmluZy46JyArIHNldE9wdHMudmVyc2lvbklkKVxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXG4gICAgbGV0IHF1ZXJ5ID0gJ2xlZ2FsLWhvbGQnXG5cbiAgICBpZiAoc2V0T3B0cy52ZXJzaW9uSWQpIHtcbiAgICAgIHF1ZXJ5ICs9IGAmdmVyc2lvbklkPSR7c2V0T3B0cy52ZXJzaW9uSWR9YFxuICAgIH1cblxuICAgIGNvbnN0IGNvbmZpZyA9IHtcbiAgICAgIFN0YXR1czogc2V0T3B0cy5zdGF0dXMsXG4gICAgfVxuXG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7IHJvb3ROYW1lOiAnTGVnYWxIb2xkJywgcmVuZGVyT3B0czogeyBwcmV0dHk6IGZhbHNlIH0sIGhlYWRsZXNzOiB0cnVlIH0pXG4gICAgY29uc3QgcGF5bG9hZCA9IGJ1aWxkZXIuYnVpbGRPYmplY3QoY29uZmlnKVxuICAgIGNvbnN0IGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fVxuICAgIGhlYWRlcnNbJ0NvbnRlbnQtTUQ1J10gPSB0b01kNShwYXlsb2FkKVxuXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnksIGhlYWRlcnMgfSwgcGF5bG9hZClcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgVGFncyBhc3NvY2lhdGVkIHdpdGggYSBCdWNrZXRcbiAgICovXG4gIGFzeW5jIGdldEJ1Y2tldFRhZ2dpbmcoYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTxUYWdbXT4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcihgSW52YWxpZCBidWNrZXQgbmFtZTogJHtidWNrZXROYW1lfWApXG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcbiAgICBjb25zdCBxdWVyeSA9ICd0YWdnaW5nJ1xuICAgIGNvbnN0IHJlcXVlc3RPcHRpb25zID0geyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH1cblxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHJlcXVlc3RPcHRpb25zKVxuICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNTdHJpbmcocmVzcG9uc2UpXG4gICAgcmV0dXJuIHhtbFBhcnNlcnMucGFyc2VUYWdnaW5nKGJvZHkpXG4gIH1cblxuICAvKipcbiAgICogIEdldCB0aGUgdGFncyBhc3NvY2lhdGVkIHdpdGggYSBidWNrZXQgT1IgYW4gb2JqZWN0XG4gICAqL1xuICBhc3luYyBnZXRPYmplY3RUYWdnaW5nKGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nLCBnZXRPcHRzOiBWZXJzaW9uSWRlbnRpZmljYXRvciA9IHt9KTogUHJvbWlzZTxUYWdbXT4ge1xuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgbGV0IHF1ZXJ5ID0gJ3RhZ2dpbmcnXG5cbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgb2JqZWN0IG5hbWU6ICcgKyBvYmplY3ROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzT2JqZWN0KGdldE9wdHMpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdnZXRPcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cblxuICAgIGlmIChnZXRPcHRzICYmIGdldE9wdHMudmVyc2lvbklkKSB7XG4gICAgICBxdWVyeSA9IGAke3F1ZXJ5fSZ2ZXJzaW9uSWQ9JHtnZXRPcHRzLnZlcnNpb25JZH1gXG4gICAgfVxuICAgIGNvbnN0IHJlcXVlc3RPcHRpb25zOiBSZXF1ZXN0T3B0aW9uID0geyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH1cbiAgICBpZiAob2JqZWN0TmFtZSkge1xuICAgICAgcmVxdWVzdE9wdGlvbnNbJ29iamVjdE5hbWUnXSA9IG9iamVjdE5hbWVcbiAgICB9XG5cbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyhyZXF1ZXN0T3B0aW9ucylcbiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzU3RyaW5nKHJlc3BvbnNlKVxuICAgIHJldHVybiB4bWxQYXJzZXJzLnBhcnNlVGFnZ2luZyhib2R5KVxuICB9XG5cbiAgLyoqXG4gICAqICBTZXQgdGhlIHBvbGljeSBvbiBhIGJ1Y2tldCBvciBhbiBvYmplY3QgcHJlZml4LlxuICAgKi9cbiAgYXN5bmMgc2V0QnVja2V0UG9saWN5KGJ1Y2tldE5hbWU6IHN0cmluZywgcG9saWN5OiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAvLyBWYWxpZGF0ZSBhcmd1bWVudHMuXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKGBJbnZhbGlkIGJ1Y2tldCBuYW1lOiAke2J1Y2tldE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhwb2xpY3kpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXRQb2xpY3lFcnJvcihgSW52YWxpZCBidWNrZXQgcG9saWN5OiAke3BvbGljeX0gLSBtdXN0IGJlIFwic3RyaW5nXCJgKVxuICAgIH1cblxuICAgIGNvbnN0IHF1ZXJ5ID0gJ3BvbGljeSdcblxuICAgIGxldCBtZXRob2QgPSAnREVMRVRFJ1xuICAgIGlmIChwb2xpY3kpIHtcbiAgICAgIG1ldGhvZCA9ICdQVVQnXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSwgcG9saWN5LCBbMjA0XSwgJycpXG4gIH1cblxuICAvKipcbiAgICogR2V0IHRoZSBwb2xpY3kgb24gYSBidWNrZXQgb3IgYW4gb2JqZWN0IHByZWZpeC5cbiAgICovXG4gIGFzeW5jIGdldEJ1Y2tldFBvbGljeShidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIC8vIFZhbGlkYXRlIGFyZ3VtZW50cy5cbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoYEludmFsaWQgYnVja2V0IG5hbWU6ICR7YnVja2V0TmFtZX1gKVxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgY29uc3QgcXVlcnkgPSAncG9saWN5J1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSlcbiAgICByZXR1cm4gYXdhaXQgcmVhZEFzU3RyaW5nKHJlcylcbiAgfVxuXG4gIGFzeW5jIHB1dE9iamVjdFJldGVudGlvbihidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgcmV0ZW50aW9uT3B0czogUmV0ZW50aW9uID0ge30pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoYEludmFsaWQgYnVja2V0IG5hbWU6ICR7YnVja2V0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzT2JqZWN0KHJldGVudGlvbk9wdHMpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdyZXRlbnRpb25PcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH0gZWxzZSB7XG4gICAgICBpZiAocmV0ZW50aW9uT3B0cy5nb3Zlcm5hbmNlQnlwYXNzICYmICFpc0Jvb2xlYW4ocmV0ZW50aW9uT3B0cy5nb3Zlcm5hbmNlQnlwYXNzKSkge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBJbnZhbGlkIHZhbHVlIGZvciBnb3Zlcm5hbmNlQnlwYXNzOiAke3JldGVudGlvbk9wdHMuZ292ZXJuYW5jZUJ5cGFzc31gKVxuICAgICAgfVxuICAgICAgaWYgKFxuICAgICAgICByZXRlbnRpb25PcHRzLm1vZGUgJiZcbiAgICAgICAgIVtSRVRFTlRJT05fTU9ERVMuQ09NUExJQU5DRSwgUkVURU5USU9OX01PREVTLkdPVkVSTkFOQ0VdLmluY2x1ZGVzKHJldGVudGlvbk9wdHMubW9kZSlcbiAgICAgICkge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBJbnZhbGlkIG9iamVjdCByZXRlbnRpb24gbW9kZTogJHtyZXRlbnRpb25PcHRzLm1vZGV9YClcbiAgICAgIH1cbiAgICAgIGlmIChyZXRlbnRpb25PcHRzLnJldGFpblVudGlsRGF0ZSAmJiAhaXNTdHJpbmcocmV0ZW50aW9uT3B0cy5yZXRhaW5VbnRpbERhdGUpKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYEludmFsaWQgdmFsdWUgZm9yIHJldGFpblVudGlsRGF0ZTogJHtyZXRlbnRpb25PcHRzLnJldGFpblVudGlsRGF0ZX1gKVxuICAgICAgfVxuICAgICAgaWYgKHJldGVudGlvbk9wdHMudmVyc2lvbklkICYmICFpc1N0cmluZyhyZXRlbnRpb25PcHRzLnZlcnNpb25JZCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgSW52YWxpZCB2YWx1ZSBmb3IgdmVyc2lvbklkOiAke3JldGVudGlvbk9wdHMudmVyc2lvbklkfWApXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcbiAgICBsZXQgcXVlcnkgPSAncmV0ZW50aW9uJ1xuXG4gICAgY29uc3QgaGVhZGVyczogUmVxdWVzdEhlYWRlcnMgPSB7fVxuICAgIGlmIChyZXRlbnRpb25PcHRzLmdvdmVybmFuY2VCeXBhc3MpIHtcbiAgICAgIGhlYWRlcnNbJ1gtQW16LUJ5cGFzcy1Hb3Zlcm5hbmNlLVJldGVudGlvbiddID0gdHJ1ZVxuICAgIH1cblxuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoeyByb290TmFtZTogJ1JldGVudGlvbicsIHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9LCBoZWFkbGVzczogdHJ1ZSB9KVxuICAgIGNvbnN0IHBhcmFtczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9XG5cbiAgICBpZiAocmV0ZW50aW9uT3B0cy5tb2RlKSB7XG4gICAgICBwYXJhbXMuTW9kZSA9IHJldGVudGlvbk9wdHMubW9kZVxuICAgIH1cbiAgICBpZiAocmV0ZW50aW9uT3B0cy5yZXRhaW5VbnRpbERhdGUpIHtcbiAgICAgIHBhcmFtcy5SZXRhaW5VbnRpbERhdGUgPSByZXRlbnRpb25PcHRzLnJldGFpblVudGlsRGF0ZVxuICAgIH1cbiAgICBpZiAocmV0ZW50aW9uT3B0cy52ZXJzaW9uSWQpIHtcbiAgICAgIHF1ZXJ5ICs9IGAmdmVyc2lvbklkPSR7cmV0ZW50aW9uT3B0cy52ZXJzaW9uSWR9YFxuICAgIH1cblxuICAgIGNvbnN0IHBheWxvYWQgPSBidWlsZGVyLmJ1aWxkT2JqZWN0KHBhcmFtcylcblxuICAgIGhlYWRlcnNbJ0NvbnRlbnQtTUQ1J10gPSB0b01kNShwYXlsb2FkKVxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHF1ZXJ5LCBoZWFkZXJzIH0sIHBheWxvYWQsIFsyMDAsIDIwNF0pXG4gIH1cblxuICBnZXRPYmplY3RMb2NrQ29uZmlnKGJ1Y2tldE5hbWU6IHN0cmluZywgY2FsbGJhY2s6IFJlc3VsdENhbGxiYWNrPE9iamVjdExvY2tJbmZvPik6IHZvaWRcbiAgZ2V0T2JqZWN0TG9ja0NvbmZpZyhidWNrZXROYW1lOiBzdHJpbmcpOiB2b2lkXG4gIGFzeW5jIGdldE9iamVjdExvY2tDb25maWcoYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTxPYmplY3RMb2NrSW5mbz5cbiAgYXN5bmMgZ2V0T2JqZWN0TG9ja0NvbmZpZyhidWNrZXROYW1lOiBzdHJpbmcpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ29iamVjdC1sb2NrJ1xuXG4gICAgY29uc3QgaHR0cFJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSlcbiAgICBjb25zdCB4bWxSZXN1bHQgPSBhd2FpdCByZWFkQXNTdHJpbmcoaHR0cFJlcylcbiAgICByZXR1cm4geG1sUGFyc2Vycy5wYXJzZU9iamVjdExvY2tDb25maWcoeG1sUmVzdWx0KVxuICB9XG5cbiAgc2V0T2JqZWN0TG9ja0NvbmZpZyhidWNrZXROYW1lOiBzdHJpbmcsIGxvY2tDb25maWdPcHRzOiBPbWl0PE9iamVjdExvY2tJbmZvLCAnb2JqZWN0TG9ja0VuYWJsZWQnPik6IHZvaWRcbiAgYXN5bmMgc2V0T2JqZWN0TG9ja0NvbmZpZyhcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXG4gICAgbG9ja0NvbmZpZ09wdHM6IE9taXQ8T2JqZWN0TG9ja0luZm8sICdvYmplY3RMb2NrRW5hYmxlZCc+LFxuICApOiBQcm9taXNlPHZvaWQ+XG4gIGFzeW5jIHNldE9iamVjdExvY2tDb25maWcoYnVja2V0TmFtZTogc3RyaW5nLCBsb2NrQ29uZmlnT3B0czogT21pdDxPYmplY3RMb2NrSW5mbywgJ29iamVjdExvY2tFbmFibGVkJz4pIHtcbiAgICBjb25zdCByZXRlbnRpb25Nb2RlcyA9IFtSRVRFTlRJT05fTU9ERVMuQ09NUExJQU5DRSwgUkVURU5USU9OX01PREVTLkdPVkVSTkFOQ0VdXG4gICAgY29uc3QgdmFsaWRVbml0cyA9IFtSRVRFTlRJT05fVkFMSURJVFlfVU5JVFMuREFZUywgUkVURU5USU9OX1ZBTElESVRZX1VOSVRTLllFQVJTXVxuXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG5cbiAgICBpZiAobG9ja0NvbmZpZ09wdHMubW9kZSAmJiAhcmV0ZW50aW9uTW9kZXMuaW5jbHVkZXMobG9ja0NvbmZpZ09wdHMubW9kZSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYGxvY2tDb25maWdPcHRzLm1vZGUgc2hvdWxkIGJlIG9uZSBvZiAke3JldGVudGlvbk1vZGVzfWApXG4gICAgfVxuICAgIGlmIChsb2NrQ29uZmlnT3B0cy51bml0ICYmICF2YWxpZFVuaXRzLmluY2x1ZGVzKGxvY2tDb25maWdPcHRzLnVuaXQpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBsb2NrQ29uZmlnT3B0cy51bml0IHNob3VsZCBiZSBvbmUgb2YgJHt2YWxpZFVuaXRzfWApXG4gICAgfVxuICAgIGlmIChsb2NrQ29uZmlnT3B0cy52YWxpZGl0eSAmJiAhaXNOdW1iZXIobG9ja0NvbmZpZ09wdHMudmFsaWRpdHkpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBsb2NrQ29uZmlnT3B0cy52YWxpZGl0eSBzaG91bGQgYmUgYSBudW1iZXJgKVxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXG4gICAgY29uc3QgcXVlcnkgPSAnb2JqZWN0LWxvY2snXG5cbiAgICBjb25zdCBjb25maWc6IE9iamVjdExvY2tDb25maWdQYXJhbSA9IHtcbiAgICAgIE9iamVjdExvY2tFbmFibGVkOiAnRW5hYmxlZCcsXG4gICAgfVxuICAgIGNvbnN0IGNvbmZpZ0tleXMgPSBPYmplY3Qua2V5cyhsb2NrQ29uZmlnT3B0cylcblxuICAgIGNvbnN0IGlzQWxsS2V5c1NldCA9IFsndW5pdCcsICdtb2RlJywgJ3ZhbGlkaXR5J10uZXZlcnkoKGxjaykgPT4gY29uZmlnS2V5cy5pbmNsdWRlcyhsY2spKVxuICAgIC8vIENoZWNrIGlmIGtleXMgYXJlIHByZXNlbnQgYW5kIGFsbCBrZXlzIGFyZSBwcmVzZW50LlxuICAgIGlmIChjb25maWdLZXlzLmxlbmd0aCA+IDApIHtcbiAgICAgIGlmICghaXNBbGxLZXlzU2V0KSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXG4gICAgICAgICAgYGxvY2tDb25maWdPcHRzLm1vZGUsbG9ja0NvbmZpZ09wdHMudW5pdCxsb2NrQ29uZmlnT3B0cy52YWxpZGl0eSBhbGwgdGhlIHByb3BlcnRpZXMgc2hvdWxkIGJlIHNwZWNpZmllZC5gLFxuICAgICAgICApXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25maWcuUnVsZSA9IHtcbiAgICAgICAgICBEZWZhdWx0UmV0ZW50aW9uOiB7fSxcbiAgICAgICAgfVxuICAgICAgICBpZiAobG9ja0NvbmZpZ09wdHMubW9kZSkge1xuICAgICAgICAgIGNvbmZpZy5SdWxlLkRlZmF1bHRSZXRlbnRpb24uTW9kZSA9IGxvY2tDb25maWdPcHRzLm1vZGVcbiAgICAgICAgfVxuICAgICAgICBpZiAobG9ja0NvbmZpZ09wdHMudW5pdCA9PT0gUkVURU5USU9OX1ZBTElESVRZX1VOSVRTLkRBWVMpIHtcbiAgICAgICAgICBjb25maWcuUnVsZS5EZWZhdWx0UmV0ZW50aW9uLkRheXMgPSBsb2NrQ29uZmlnT3B0cy52YWxpZGl0eVxuICAgICAgICB9IGVsc2UgaWYgKGxvY2tDb25maWdPcHRzLnVuaXQgPT09IFJFVEVOVElPTl9WQUxJRElUWV9VTklUUy5ZRUFSUykge1xuICAgICAgICAgIGNvbmZpZy5SdWxlLkRlZmF1bHRSZXRlbnRpb24uWWVhcnMgPSBsb2NrQ29uZmlnT3B0cy52YWxpZGl0eVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7XG4gICAgICByb290TmFtZTogJ09iamVjdExvY2tDb25maWd1cmF0aW9uJyxcbiAgICAgIHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9LFxuICAgICAgaGVhZGxlc3M6IHRydWUsXG4gICAgfSlcbiAgICBjb25zdCBwYXlsb2FkID0gYnVpbGRlci5idWlsZE9iamVjdChjb25maWcpXG5cbiAgICBjb25zdCBoZWFkZXJzOiBSZXF1ZXN0SGVhZGVycyA9IHt9XG4gICAgaGVhZGVyc1snQ29udGVudC1NRDUnXSA9IHRvTWQ1KHBheWxvYWQpXG5cbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSwgaGVhZGVycyB9LCBwYXlsb2FkKVxuICB9XG5cbiAgYXN5bmMgZ2V0QnVja2V0VmVyc2lvbmluZyhidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ3ZlcnNpb25pbmcnXG5cbiAgICBjb25zdCBodHRwUmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9KVxuICAgIGNvbnN0IHhtbFJlc3VsdCA9IGF3YWl0IHJlYWRBc1N0cmluZyhodHRwUmVzKVxuICAgIHJldHVybiBhd2FpdCB4bWxQYXJzZXJzLnBhcnNlQnVja2V0VmVyc2lvbmluZ0NvbmZpZyh4bWxSZXN1bHQpXG4gIH1cblxuICBhc3luYyBzZXRCdWNrZXRWZXJzaW9uaW5nKGJ1Y2tldE5hbWU6IHN0cmluZywgdmVyc2lvbkNvbmZpZzogQnVja2V0VmVyc2lvbmluZ0NvbmZpZ3VyYXRpb24pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIU9iamVjdC5rZXlzKHZlcnNpb25Db25maWcpLmxlbmd0aCkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigndmVyc2lvbkNvbmZpZyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2QgPSAnUFVUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ3ZlcnNpb25pbmcnXG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7XG4gICAgICByb290TmFtZTogJ1ZlcnNpb25pbmdDb25maWd1cmF0aW9uJyxcbiAgICAgIHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9LFxuICAgICAgaGVhZGxlc3M6IHRydWUsXG4gICAgfSlcbiAgICBjb25zdCBwYXlsb2FkID0gYnVpbGRlci5idWlsZE9iamVjdCh2ZXJzaW9uQ29uZmlnKVxuXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSwgcGF5bG9hZClcbiAgfVxufVxuIl0sIm1hcHBpbmdzIjoiQUFBQSxPQUFPLEtBQUtBLE1BQU07QUFDbEIsT0FBTyxLQUFLQyxFQUFFO0FBQ2QsT0FBTyxLQUFLQyxJQUFJO0FBQ2hCLE9BQU8sS0FBS0MsS0FBSztBQUNqQixPQUFPLEtBQUtDLElBQUk7QUFDaEIsT0FBTyxLQUFLQyxNQUFNO0FBRWxCLE9BQU8sS0FBS0MsS0FBSyxNQUFNLE9BQU87QUFDOUIsT0FBT0MsWUFBWSxNQUFNLGVBQWU7QUFDeEMsU0FBU0MsU0FBUyxRQUFRLGlCQUFpQjtBQUMzQyxPQUFPQyxDQUFDLE1BQU0sUUFBUTtBQUN0QixPQUFPLEtBQUtDLEVBQUUsTUFBTSxjQUFjO0FBQ2xDLE9BQU9DLE1BQU0sTUFBTSxRQUFRO0FBRTNCLFNBQVNDLGtCQUFrQixRQUFRLDJCQUEwQjtBQUM3RCxPQUFPLEtBQUtDLE1B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