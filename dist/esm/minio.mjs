/*
 * MinIO Javascript Library for Amazon S3 Compatible Cloud Storage, (C) 2015 MinIO, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as Stream from "stream";
import async from 'async';
import _ from 'lodash';
import * as querystring from 'query-string';
import { TextEncoder } from 'web-encoding';
import xml2js from 'xml2js';
import * as errors from "./errors.mjs";
import { CopyDestinationOptions, CopySourceOptions } from "./helpers.mjs";
import { callbackify } from "./internal/callbackify.mjs";
import { TypedClient } from "./internal/client.mjs";
import { CopyConditions } from "./internal/copy-conditions.mjs";
import { calculateEvenSplits, extractMetadata, getScope, getSourceVersionId, getVersionId, isBoolean, isFunction, isNumber, isObject, isString, isValidBucketName, isValidDate, isValidObjectName, isValidPrefix, makeDateLong, PART_CONSTRAINTS, partsRequired, pipesetup, sanitizeETag, toMd5, uriEscape, uriResourceEscape } from "./internal/helper.mjs";
import { PostPolicy } from "./internal/post-policy.mjs";
import { NotificationConfig, NotificationPoller } from "./notification.mjs";
import { promisify } from "./promisify.mjs";
import { postPresignSignatureV4, presignSignatureV4 } from "./signing.mjs";
import * as transformers from "./transformers.mjs";
import { parseSelectObjectContentResponse } from "./xml-parsers.mjs";
export * from "./errors.mjs";
export * from "./helpers.mjs";
export * from "./notification.mjs";
export { CopyConditions, PostPolicy };
export class Client extends TypedClient {
  // Set application specific information.
  //
  // Generates User-Agent in the following style.
  //
  //       MinIO (OS; ARCH) LIB/VER APP/VER
  //
  // __Arguments__
  // * `appName` _string_ - Application name.
  // * `appVersion` _string_ - Application version.
  setAppInfo(appName, appVersion) {
    if (!isString(appName)) {
      throw new TypeError(`Invalid appName: ${appName}`);
    }
    if (appName.trim() === '') {
      throw new errors.InvalidArgumentError('Input appName cannot be empty.');
    }
    if (!isString(appVersion)) {
      throw new TypeError(`Invalid appVersion: ${appVersion}`);
    }
    if (appVersion.trim() === '') {
      throw new errors.InvalidArgumentError('Input appVersion cannot be empty.');
    }
    this.userAgent = `${this.userAgent} ${appName}/${appVersion}`;
  }

  // Remove the partially uploaded object.
  //
  // __Arguments__
  // * `bucketName` _string_: name of the bucket
  // * `objectName` _string_: name of the object
  // * `callback(err)` _function_: callback function is called with non `null` value in case of error
  removeIncompleteUpload(bucketName, objectName, cb) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.IsValidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isFunction(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    var removeUploadId;
    async.during(cb => {
      this.findUploadId(bucketName, objectName).then(uploadId => {
        removeUploadId = uploadId;
        cb(null, uploadId);
      }, cb);
    }, cb => {
      var method = 'DELETE';
      var query = `uploadId=${removeUploadId}`;
      this.makeRequest({
        method,
        bucketName,
        objectName,
        query
      }, '', [204], '', false, e => cb(e));
    }, cb);
  }

  // Copy the object.
  //
  // __Arguments__
  // * `bucketName` _string_: name of the bucket
  // * `objectName` _string_: name of the object
  // * `srcObject` _string_: path of the source object to be copied
  // * `conditions` _CopyConditions_: copy conditions that needs to be satisfied (optional, default `null`)
  // * `callback(err, {etag, lastModified})` _function_: non null `err` indicates error, `etag` _string_ and `listModifed` _Date_ are respectively the etag and the last modified date of the newly copied object
  copyObjectV1(arg1, arg2, arg3, arg4, arg5) {
    var bucketName = arg1;
    var objectName = arg2;
    var srcObject = arg3;
    var conditions, cb;
    if (typeof arg4 == 'function' && arg5 === undefined) {
      conditions = null;
      cb = arg4;
    } else {
      conditions = arg4;
      cb = arg5;
    }
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isString(srcObject)) {
      throw new TypeError('srcObject should be of type "string"');
    }
    if (srcObject === '') {
      throw new errors.InvalidPrefixError(`Empty source prefix`);
    }
    if (conditions !== null && !(conditions instanceof CopyConditions)) {
      throw new TypeError('conditions should be of type "CopyConditions"');
    }
    var headers = {};
    headers['x-amz-copy-source'] = uriResourceEscape(srcObject);
    if (conditions !== null) {
      if (conditions.modified !== '') {
        headers['x-amz-copy-source-if-modified-since'] = conditions.modified;
      }
      if (conditions.unmodified !== '') {
        headers['x-amz-copy-source-if-unmodified-since'] = conditions.unmodified;
      }
      if (conditions.matchETag !== '') {
        headers['x-amz-copy-source-if-match'] = conditions.matchETag;
      }
      if (conditions.matchEtagExcept !== '') {
        headers['x-amz-copy-source-if-none-match'] = conditions.matchETagExcept;
      }
    }
    var method = 'PUT';
    this.makeRequest({
      method,
      bucketName,
      objectName,
      headers
    }, '', [200], '', true, (e, response) => {
      if (e) {
        return cb(e);
      }
      var transformer = transformers.getCopyObjectTransformer();
      pipesetup(response, transformer).on('error', e => cb(e)).on('data', data => cb(null, data));
    });
  }

  /**
   * Internal Method to perform copy of an object.
   * @param sourceConfig __object__   instance of CopySourceOptions @link ./helpers/CopySourceOptions
   * @param destConfig  __object__   instance of CopyDestinationOptions @link ./helpers/CopyDestinationOptions
   * @param cb __function__ called with null if there is an error
   * @returns Promise if no callack is passed.
   */
  copyObjectV2(sourceConfig, destConfig, cb) {
    if (!(sourceConfig instanceof CopySourceOptions)) {
      throw new errors.InvalidArgumentError('sourceConfig should of type CopySourceOptions ');
    }
    if (!(destConfig instanceof CopyDestinationOptions)) {
      throw new errors.InvalidArgumentError('destConfig should of type CopyDestinationOptions ');
    }
    if (!destConfig.validate()) {
      return false;
    }
    if (!destConfig.validate()) {
      return false;
    }
    if (!isFunction(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    const headers = Object.assign({}, sourceConfig.getHeaders(), destConfig.getHeaders());
    const bucketName = destConfig.Bucket;
    const objectName = destConfig.Object;
    const method = 'PUT';
    this.makeRequest({
      method,
      bucketName,
      objectName,
      headers
    }, '', [200], '', true, (e, response) => {
      if (e) {
        return cb(e);
      }
      const transformer = transformers.getCopyObjectTransformer();
      pipesetup(response, transformer).on('error', e => cb(e)).on('data', data => {
        const resHeaders = response.headers;
        const copyObjResponse = {
          Bucket: destConfig.Bucket,
          Key: destConfig.Object,
          LastModified: data.LastModified,
          MetaData: extractMetadata(resHeaders),
          VersionId: getVersionId(resHeaders),
          SourceVersionId: getSourceVersionId(resHeaders),
          Etag: sanitizeETag(resHeaders.etag),
          Size: +resHeaders['content-length']
        };
        return cb(null, copyObjResponse);
      });
    });
  }

  // Backward compatibility for Copy Object API.
  copyObject(...allArgs) {
    if (allArgs[0] instanceof CopySourceOptions && allArgs[1] instanceof CopyDestinationOptions) {
      return this.copyObjectV2(...arguments);
    }
    return this.copyObjectV1(...arguments);
  }

  // list a batch of objects
  listObjectsQuery(bucketName, prefix, marker, listQueryOpts = {}) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isString(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (!isString(marker)) {
      throw new TypeError('marker should be of type "string"');
    }
    let {
      Delimiter,
      MaxKeys,
      IncludeVersion
    } = listQueryOpts;
    if (!isObject(listQueryOpts)) {
      throw new TypeError('listQueryOpts should be of type "object"');
    }
    if (!isString(Delimiter)) {
      throw new TypeError('Delimiter should be of type "string"');
    }
    if (!isNumber(MaxKeys)) {
      throw new TypeError('MaxKeys should be of type "number"');
    }
    const queries = [];
    // escape every value in query string, except maxKeys
    queries.push(`prefix=${uriEscape(prefix)}`);
    queries.push(`delimiter=${uriEscape(Delimiter)}`);
    queries.push(`encoding-type=url`);
    if (IncludeVersion) {
      queries.push(`versions`);
    }
    if (marker) {
      marker = uriEscape(marker);
      if (IncludeVersion) {
        queries.push(`key-marker=${marker}`);
      } else {
        queries.push(`marker=${marker}`);
      }
    }

    // no need to escape maxKeys
    if (MaxKeys) {
      if (MaxKeys >= 1000) {
        MaxKeys = 1000;
      }
      queries.push(`max-keys=${MaxKeys}`);
    }
    queries.sort();
    var query = '';
    if (queries.length > 0) {
      query = `${queries.join('&')}`;
    }
    var method = 'GET';
    var transformer = transformers.getListObjectsTransformer();
    this.makeRequest({
      method,
      bucketName,
      query
    }, '', [200], '', true, (e, response) => {
      if (e) {
        return transformer.emit('error', e);
      }
      pipesetup(response, transformer);
    });
    return transformer;
  }

  // List the objects in the bucket.
  //
  // __Arguments__
  // * `bucketName` _string_: name of the bucket
  // * `prefix` _string_: the prefix of the objects that should be listed (optional, default `''`)
  // * `recursive` _bool_: `true` indicates recursive style listing and `false` indicates directory style listing delimited by '/'. (optional, default `false`)
  // * `listOpts _object_: query params to list object with below keys
  // *    listOpts.MaxKeys _int_ maximum number of keys to return
  // *    listOpts.IncludeVersion  _bool_ true|false to include versions.
  // __Return Value__
  // * `stream` _Stream_: stream emitting the objects in the bucket, the object is of the format:
  // * `obj.name` _string_: name of the object
  // * `obj.prefix` _string_: name of the object prefix
  // * `obj.size` _number_: size of the object
  // * `obj.etag` _string_: etag of the object
  // * `obj.lastModified` _Date_: modified time stamp
  // * `obj.isDeleteMarker` _boolean_: true if it is a delete marker
  // * `obj.versionId` _string_: versionId of the object
  listObjects(bucketName, prefix, recursive, listOpts = {}) {
    if (prefix === undefined) {
      prefix = '';
    }
    if (recursive === undefined) {
      recursive = false;
    }
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidPrefix(prefix)) {
      throw new errors.InvalidPrefixError(`Invalid prefix : ${prefix}`);
    }
    if (!isString(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (!isBoolean(recursive)) {
      throw new TypeError('recursive should be of type "boolean"');
    }
    if (!isObject(listOpts)) {
      throw new TypeError('listOpts should be of type "object"');
    }
    var marker = '';
    const listQueryOpts = {
      Delimiter: recursive ? '' : '/',
      // if recursive is false set delimiter to '/'
      MaxKeys: 1000,
      IncludeVersion: listOpts.IncludeVersion
    };
    var objects = [];
    var ended = false;
    var readStream = Stream.Readable({
      objectMode: true
    });
    readStream._read = () => {
      // push one object per _read()
      if (objects.length) {
        readStream.push(objects.shift());
        return;
      }
      if (ended) {
        return readStream.push(null);
      }
      // if there are no objects to push do query for the next batch of objects
      this.listObjectsQuery(bucketName, prefix, marker, listQueryOpts).on('error', e => readStream.emit('error', e)).on('data', result => {
        if (result.isTruncated) {
          marker = result.nextMarker || result.versionIdMarker;
        } else {
          ended = true;
        }
        objects = result.objects;
        readStream._read();
      });
    };
    return readStream;
  }

  // listObjectsV2Query - (List Objects V2) - List some or all (up to 1000) of the objects in a bucket.
  //
  // You can use the request parameters as selection criteria to return a subset of the objects in a bucket.
  // request parameters :-
  // * `bucketName` _string_: name of the bucket
  // * `prefix` _string_: Limits the response to keys that begin with the specified prefix.
  // * `continuation-token` _string_: Used to continue iterating over a set of objects.
  // * `delimiter` _string_: A delimiter is a character you use to group keys.
  // * `max-keys` _number_: Sets the maximum number of keys returned in the response body.
  // * `start-after` _string_: Specifies the key to start after when listing objects in a bucket.
  listObjectsV2Query(bucketName, prefix, continuationToken, delimiter, maxKeys, startAfter) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isString(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (!isString(continuationToken)) {
      throw new TypeError('continuationToken should be of type "string"');
    }
    if (!isString(delimiter)) {
      throw new TypeError('delimiter should be of type "string"');
    }
    if (!isNumber(maxKeys)) {
      throw new TypeError('maxKeys should be of type "number"');
    }
    if (!isString(startAfter)) {
      throw new TypeError('startAfter should be of type "string"');
    }
    var queries = [];

    // Call for listing objects v2 API
    queries.push(`list-type=2`);
    queries.push(`encoding-type=url`);

    // escape every value in query string, except maxKeys
    queries.push(`prefix=${uriEscape(prefix)}`);
    queries.push(`delimiter=${uriEscape(delimiter)}`);
    if (continuationToken) {
      continuationToken = uriEscape(continuationToken);
      queries.push(`continuation-token=${continuationToken}`);
    }
    // Set start-after
    if (startAfter) {
      startAfter = uriEscape(startAfter);
      queries.push(`start-after=${startAfter}`);
    }
    // no need to escape maxKeys
    if (maxKeys) {
      if (maxKeys >= 1000) {
        maxKeys = 1000;
      }
      queries.push(`max-keys=${maxKeys}`);
    }
    queries.sort();
    var query = '';
    if (queries.length > 0) {
      query = `${queries.join('&')}`;
    }
    var method = 'GET';
    var transformer = transformers.getListObjectsV2Transformer();
    this.makeRequest({
      method,
      bucketName,
      query
    }, '', [200], '', true, (e, response) => {
      if (e) {
        return transformer.emit('error', e);
      }
      pipesetup(response, transformer);
    });
    return transformer;
  }

  // List the objects in the bucket using S3 ListObjects V2
  //
  // __Arguments__
  // * `bucketName` _string_: name of the bucket
  // * `prefix` _string_: the prefix of the objects that should be listed (optional, default `''`)
  // * `recursive` _bool_: `true` indicates recursive style listing and `false` indicates directory style listing delimited by '/'. (optional, default `false`)
  // * `startAfter` _string_: Specifies the key to start after when listing objects in a bucket. (optional, default `''`)
  //
  // __Return Value__
  // * `stream` _Stream_: stream emitting the objects in the bucket, the object is of the format:
  //   * `obj.name` _string_: name of the object
  //   * `obj.prefix` _string_: name of the object prefix
  //   * `obj.size` _number_: size of the object
  //   * `obj.etag` _string_: etag of the object
  //   * `obj.lastModified` _Date_: modified time stamp
  listObjectsV2(bucketName, prefix, recursive, startAfter) {
    if (prefix === undefined) {
      prefix = '';
    }
    if (recursive === undefined) {
      recursive = false;
    }
    if (startAfter === undefined) {
      startAfter = '';
    }
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidPrefix(prefix)) {
      throw new errors.InvalidPrefixError(`Invalid prefix : ${prefix}`);
    }
    if (!isString(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (!isBoolean(recursive)) {
      throw new TypeError('recursive should be of type "boolean"');
    }
    if (!isString(startAfter)) {
      throw new TypeError('startAfter should be of type "string"');
    }
    // if recursive is false set delimiter to '/'
    var delimiter = recursive ? '' : '/';
    var continuationToken = '';
    var objects = [];
    var ended = false;
    var readStream = Stream.Readable({
      objectMode: true
    });
    readStream._read = () => {
      // push one object per _read()
      if (objects.length) {
        readStream.push(objects.shift());
        return;
      }
      if (ended) {
        return readStream.push(null);
      }
      // if there are no objects to push do query for the next batch of objects
      this.listObjectsV2Query(bucketName, prefix, continuationToken, delimiter, 1000, startAfter).on('error', e => readStream.emit('error', e)).on('data', result => {
        if (result.isTruncated) {
          continuationToken = result.nextContinuationToken;
        } else {
          ended = true;
        }
        objects = result.objects;
        readStream._read();
      });
    };
    return readStream;
  }

  // Remove all the objects residing in the objectsList.
  //
  // __Arguments__
  // * `bucketName` _string_: name of the bucket
  // * `objectsList` _array_: array of objects of one of the following:
  // *         List of Object names as array of strings which are object keys:  ['objectname1','objectname2']
  // *         List of Object name and versionId as an object:  [{name:"objectname",versionId:"my-version-id"}]

  removeObjects(bucketName, objectsList, cb) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!Array.isArray(objectsList)) {
      throw new errors.InvalidArgumentError('objectsList should be a list');
    }
    if (!isFunction(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    const maxEntries = 1000;
    const query = 'delete';
    const method = 'POST';
    let result = objectsList.reduce((result, entry) => {
      result.list.push(entry);
      if (result.list.length === maxEntries) {
        result.listOfList.push(result.list);
        result.list = [];
      }
      return result;
    }, {
      listOfList: [],
      list: []
    });
    if (result.list.length > 0) {
      result.listOfList.push(result.list);
    }
    const encoder = new TextEncoder();
    const batchResults = [];
    async.eachSeries(result.listOfList, (list, batchCb) => {
      var objects = [];
      list.forEach(function (value) {
        if (isObject(value)) {
          objects.push({
            Key: value.name,
            VersionId: value.versionId
          });
        } else {
          objects.push({
            Key: value
          });
        }
      });
      let deleteObjects = {
        Delete: {
          Quiet: true,
          Object: objects
        }
      };
      const builder = new xml2js.Builder({
        headless: true
      });
      let payload = builder.buildObject(deleteObjects);
      payload = Buffer.from(encoder.encode(payload));
      const headers = {};
      headers['Content-MD5'] = toMd5(payload);
      let removeObjectsResult;
      this.makeRequest({
        method,
        bucketName,
        query,
        headers
      }, payload, [200], '', true, (e, response) => {
        if (e) {
          return batchCb(e);
        }
        pipesetup(response, transformers.removeObjectsTransformer()).on('data', data => {
          removeObjectsResult = data;
        }).on('error', e => {
          return batchCb(e, null);
        }).on('end', () => {
          batchResults.push(removeObjectsResult);
          return batchCb(null, removeObjectsResult);
        });
      });
    }, () => {
      cb(null, _.flatten(batchResults));
    });
  }

  // Generate a generic presigned URL which can be
  // used for HTTP methods GET, PUT, HEAD and DELETE
  //
  // __Arguments__
  // * `method` _string_: name of the HTTP method
  // * `bucketName` _string_: name of the bucket
  // * `objectName` _string_: name of the object
  // * `expiry` _number_: expiry in seconds (optional, default 7 days)
  // * `reqParams` _object_: request parameters (optional) e.g {versionId:"10fa9946-3f64-4137-a58f-888065c0732e"}
  // * `requestDate` _Date_: A date object, the url will be issued at (optional)
  presignedUrl(method, bucketName, objectName, expires, reqParams, requestDate, cb) {
    if (this.anonymous) {
      throw new errors.AnonymousRequestError('Presigned ' + method + ' url cannot be generated for anonymous requests');
    }
    if (isFunction(requestDate)) {
      cb = requestDate;
      requestDate = new Date();
    }
    if (isFunction(reqParams)) {
      cb = reqParams;
      reqParams = {};
      requestDate = new Date();
    }
    if (isFunction(expires)) {
      cb = expires;
      reqParams = {};
      expires = 24 * 60 * 60 * 7; // 7 days in seconds
      requestDate = new Date();
    }
    if (!isNumber(expires)) {
      throw new TypeError('expires should be of type "number"');
    }
    if (!isObject(reqParams)) {
      throw new TypeError('reqParams should be of type "object"');
    }
    if (!isValidDate(requestDate)) {
      throw new TypeError('requestDate should be of type "Date" and valid');
    }
    if (!isFunction(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    var query = querystring.stringify(reqParams);
    this.getBucketRegion(bucketName, (e, region) => {
      if (e) {
        return cb(e);
      }
      // This statement is added to ensure that we send error through
      // callback on presign failure.
      var url;
      var reqOptions = this.getRequestOptions({
        method,
        region,
        bucketName,
        objectName,
        query
      });
      this.checkAndRefreshCreds();
      try {
        url = presignSignatureV4(reqOptions, this.accessKey, this.secretKey, this.sessionToken, region, requestDate, expires);
      } catch (pe) {
        return cb(pe);
      }
      cb(null, url);
    });
  }

  // Generate a presigned URL for GET
  //
  // __Arguments__
  // * `bucketName` _string_: name of the bucket
  // * `objectName` _string_: name of the object
  // * `expiry` _number_: expiry in seconds (optional, default 7 days)
  // * `respHeaders` _object_: response headers to override or request params for query (optional) e.g {versionId:"10fa9946-3f64-4137-a58f-888065c0732e"}
  // * `requestDate` _Date_: A date object, the url will be issued at (optional)
  presignedGetObject(bucketName, objectName, expires, respHeaders, requestDate, cb) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (isFunction(respHeaders)) {
      cb = respHeaders;
      respHeaders = {};
      requestDate = new Date();
    }
    var validRespHeaders = ['response-content-type', 'response-content-language', 'response-expires', 'response-cache-control', 'response-content-disposition', 'response-content-encoding'];
    validRespHeaders.forEach(header => {
      if (respHeaders !== undefined && respHeaders[header] !== undefined && !isString(respHeaders[header])) {
        throw new TypeError(`response header ${header} should be of type "string"`);
      }
    });
    return this.presignedUrl('GET', bucketName, objectName, expires, respHeaders, requestDate, cb);
  }

  // Generate a presigned URL for PUT. Using this URL, the browser can upload to S3 only with the specified object name.
  //
  // __Arguments__
  // * `bucketName` _string_: name of the bucket
  // * `objectName` _string_: name of the object
  // * `expiry` _number_: expiry in seconds (optional, default 7 days)
  presignedPutObject(bucketName, objectName, expires, cb) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    return this.presignedUrl('PUT', bucketName, objectName, expires, cb);
  }

  // return PostPolicy object
  newPostPolicy() {
    return new PostPolicy();
  }

  // presignedPostPolicy can be used in situations where we want more control on the upload than what
  // presignedPutObject() provides. i.e Using presignedPostPolicy we will be able to put policy restrictions
  // on the object's `name` `bucket` `expiry` `Content-Type` `Content-Disposition` `metaData`
  presignedPostPolicy(postPolicy, cb) {
    if (this.anonymous) {
      throw new errors.AnonymousRequestError('Presigned POST policy cannot be generated for anonymous requests');
    }
    if (!isObject(postPolicy)) {
      throw new TypeError('postPolicy should be of type "object"');
    }
    if (!isFunction(cb)) {
      throw new TypeError('cb should be of type "function"');
    }
    this.getBucketRegion(postPolicy.formData.bucket, (e, region) => {
      if (e) {
        return cb(e);
      }
      var date = new Date();
      var dateStr = makeDateLong(date);
      this.checkAndRefreshCreds();
      if (!postPolicy.policy.expiration) {
        // 'expiration' is mandatory field for S3.
        // Set default expiration date of 7 days.
        var expires = new Date();
        expires.setSeconds(24 * 60 * 60 * 7);
        postPolicy.setExpires(expires);
      }
      postPolicy.policy.conditions.push(['eq', '$x-amz-date', dateStr]);
      postPolicy.formData['x-amz-date'] = dateStr;
      postPolicy.policy.conditions.push(['eq', '$x-amz-algorithm', 'AWS4-HMAC-SHA256']);
      postPolicy.formData['x-amz-algorithm'] = 'AWS4-HMAC-SHA256';
      postPolicy.policy.conditions.push(['eq', '$x-amz-credential', this.accessKey + '/' + getScope(region, date)]);
      postPolicy.formData['x-amz-credential'] = this.accessKey + '/' + getScope(region, date);
      if (this.sessionToken) {
        postPolicy.policy.conditions.push(['eq', '$x-amz-security-token', this.sessionToken]);
        postPolicy.formData['x-amz-security-token'] = this.sessionToken;
      }
      var policyBase64 = Buffer.from(JSON.stringify(postPolicy.policy)).toString('base64');
      postPolicy.formData.policy = policyBase64;
      var signature = postPresignSignatureV4(region, date, this.secretKey, policyBase64);
      postPolicy.formData['x-amz-signature'] = signature;
      var opts = {};
      opts.region = region;
      opts.bucketName = postPolicy.formData.bucket;
      var reqOptions = this.getRequestOptions(opts);
      var portStr = this.port == 80 || this.port === 443 ? '' : `:${this.port.toString()}`;
      var urlStr = `${reqOptions.protocol}//${reqOptions.host}${portStr}${reqOptions.path}`;
      cb(null, {
        postURL: urlStr,
        formData: postPolicy.formData
      });
    });
  }

  // Remove all the notification configurations in the S3 provider
  setBucketNotification(bucketName, config, cb) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isObject(config)) {
      throw new TypeError('notification config should be of type "Object"');
    }
    if (!isFunction(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    var method = 'PUT';
    var query = 'notification';
    var builder = new xml2js.Builder({
      rootName: 'NotificationConfiguration',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    var payload = builder.buildObject(config);
    this.makeRequest({
      method,
      bucketName,
      query
    }, payload, [200], '', false, cb);
  }
  removeAllBucketNotification(bucketName, cb) {
    this.setBucketNotification(bucketName, new NotificationConfig(), cb);
  }

  // Return the list of notification configurations stored
  // in the S3 provider
  getBucketNotification(bucketName, cb) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isFunction(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    var method = 'GET';
    var query = 'notification';
    this.makeRequest({
      method,
      bucketName,
      query
    }, '', [200], '', true, (e, response) => {
      if (e) {
        return cb(e);
      }
      var transformer = transformers.getBucketNotificationTransformer();
      var bucketNotification;
      pipesetup(response, transformer).on('data', result => bucketNotification = result).on('error', e => cb(e)).on('end', () => cb(null, bucketNotification));
    });
  }

  // Listens for bucket notifications. Returns an EventEmitter.
  listenBucketNotification(bucketName, prefix, suffix, events) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!isString(prefix)) {
      throw new TypeError('prefix must be of type string');
    }
    if (!isString(suffix)) {
      throw new TypeError('suffix must be of type string');
    }
    if (!Array.isArray(events)) {
      throw new TypeError('events must be of type Array');
    }
    let listener = new NotificationPoller(this, bucketName, prefix, suffix, events);
    listener.start();
    return listener;
  }

  /** To set Tags on a bucket or object based on the params
   *  __Arguments__
   * taggingParams _object_ Which contains the following properties
   *  bucketName _string_,
   *  objectName _string_ (Optional),
   *  tags _object_ of the form {'<tag-key-1>':'<tag-value-1>','<tag-key-2>':'<tag-value-2>'}
   *  putOpts _object_ (Optional) e.g {versionId:"my-object-version-id"},
   *  cb(error)` _function_ - callback function with `err` as the error argument. `err` is null if the operation is successful.
   */
  setTagging(taggingParams) {
    const {
      bucketName,
      objectName,
      tags,
      putOpts = {},
      cb
    } = taggingParams;
    const method = 'PUT';
    let query = 'tagging';
    if (putOpts && putOpts.versionId) {
      query = `${query}&versionId=${putOpts.versionId}`;
    }
    const tagsList = [];
    for (const [key, value] of Object.entries(tags)) {
      tagsList.push({
        Key: key,
        Value: value
      });
    }
    const taggingConfig = {
      Tagging: {
        TagSet: {
          Tag: tagsList
        }
      }
    };
    const encoder = new TextEncoder();
    const headers = {};
    const builder = new xml2js.Builder({
      headless: true,
      renderOpts: {
        pretty: false
      }
    });
    let payload = builder.buildObject(taggingConfig);
    payload = Buffer.from(encoder.encode(payload));
    headers['Content-MD5'] = toMd5(payload);
    const requestOptions = {
      method,
      bucketName,
      query,
      headers
    };
    if (objectName) {
      requestOptions['objectName'] = objectName;
    }
    headers['Content-MD5'] = toMd5(payload);
    this.makeRequest(requestOptions, payload, [200], '', false, cb);
  }

  /** Set Tags on a Bucket
   * __Arguments__
   * bucketName _string_
   * tags _object_ of the form {'<tag-key-1>':'<tag-value-1>','<tag-key-2>':'<tag-value-2>'}
   * `cb(error)` _function_ - callback function with `err` as the error argument. `err` is null if the operation is successful.
   */
  setBucketTagging(bucketName, tags, cb) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isObject(tags)) {
      throw new errors.InvalidArgumentError('tags should be of type "object"');
    }
    if (Object.keys(tags).length > 10) {
      throw new errors.InvalidArgumentError('maximum tags allowed is 10"');
    }
    if (!isFunction(cb)) {
      throw new errors.InvalidArgumentError('callback should be of type "function"');
    }
    return this.setTagging({
      bucketName,
      tags,
      cb
    });
  }

  /** Set Tags on an Object
   * __Arguments__
   * bucketName _string_
   * objectName _string_
   *  * tags _object_ of the form {'<tag-key-1>':'<tag-value-1>','<tag-key-2>':'<tag-value-2>'}
   *  putOpts _object_ (Optional) e.g {versionId:"my-object-version-id"},
   * `cb(error)` _function_ - callback function with `err` as the error argument. `err` is null if the operation is successful.
   */
  setObjectTagging(bucketName, objectName, tags, putOpts = {}, cb) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidBucketNameError('Invalid object name: ' + objectName);
    }
    if (isFunction(putOpts)) {
      cb = putOpts;
      putOpts = {};
    }
    if (!isObject(tags)) {
      throw new errors.InvalidArgumentError('tags should be of type "object"');
    }
    if (Object.keys(tags).length > 10) {
      throw new errors.InvalidArgumentError('Maximum tags allowed is 10"');
    }
    if (!isFunction(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    return this.setTagging({
      bucketName,
      objectName,
      tags,
      putOpts,
      cb
    });
  }

  /** Remove Tags on an Bucket/Object based on params
   * __Arguments__
   * bucketName _string_
   * objectName _string_ (optional)
   * removeOpts _object_ (Optional) e.g {versionId:"my-object-version-id"},
   * `cb(error)` _function_ - callback function with `err` as the error argument. `err` is null if the operation is successful.
   */
  removeTagging({
    bucketName,
    objectName,
    removeOpts,
    cb
  }) {
    const method = 'DELETE';
    let query = 'tagging';
    if (removeOpts && Object.keys(removeOpts).length && removeOpts.versionId) {
      query = `${query}&versionId=${removeOpts.versionId}`;
    }
    const requestOptions = {
      method,
      bucketName,
      objectName,
      query
    };
    if (objectName) {
      requestOptions['objectName'] = objectName;
    }
    this.makeRequest(requestOptions, '', [200, 204], '', true, cb);
  }

  /** Remove Tags associated with a bucket
   *  __Arguments__
   * bucketName _string_
   * `cb(error)` _function_ - callback function with `err` as the error argument. `err` is null if the operation is successful.
   */
  removeBucketTagging(bucketName, cb) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isFunction(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    return this.removeTagging({
      bucketName,
      cb
    });
  }

  /** Remove tags associated with an object
   * __Arguments__
   * bucketName _string_
   * objectName _string_
   * removeOpts _object_ (Optional) e.g. {VersionID:"my-object-version-id"}
   * `cb(error)` _function_ - callback function with `err` as the error argument. `err` is null if the operation is successful.
   */
  removeObjectTagging(bucketName, objectName, removeOpts, cb) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidBucketNameError('Invalid object name: ' + objectName);
    }
    if (isFunction(removeOpts)) {
      cb = removeOpts;
      removeOpts = {};
    }
    if (removeOpts && Object.keys(removeOpts).length && !isObject(removeOpts)) {
      throw new errors.InvalidArgumentError('removeOpts should be of type "object"');
    }
    if (!isFunction(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    return this.removeTagging({
      bucketName,
      objectName,
      removeOpts,
      cb
    });
  }

  /**
   * Apply lifecycle configuration on a bucket.
   * bucketName _string_
   * policyConfig _object_ a valid policy configuration object.
   * `cb(error)` _function_ - callback function with `err` as the error argument. `err` is null if the operation is successful.
   */
  applyBucketLifecycle(bucketName, policyConfig, cb) {
    const method = 'PUT';
    const query = 'lifecycle';
    const encoder = new TextEncoder();
    const headers = {};
    const builder = new xml2js.Builder({
      rootName: 'LifecycleConfiguration',
      headless: true,
      renderOpts: {
        pretty: false
      }
    });
    let payload = builder.buildObject(policyConfig);
    payload = Buffer.from(encoder.encode(payload));
    const requestOptions = {
      method,
      bucketName,
      query,
      headers
    };
    headers['Content-MD5'] = toMd5(payload);
    this.makeRequest(requestOptions, payload, [200], '', false, cb);
  }

  /** Remove lifecycle configuration of a bucket.
   * bucketName _string_
   * `cb(error)` _function_ - callback function with `err` as the error argument. `err` is null if the operation is successful.
   */
  removeBucketLifecycle(bucketName, cb) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'DELETE';
    const query = 'lifecycle';
    this.makeRequest({
      method,
      bucketName,
      query
    }, '', [204], '', false, cb);
  }

  /** Set/Override lifecycle configuration on a bucket. if the configuration is empty, it removes the configuration.
   * bucketName _string_
   * lifeCycleConfig _object_ one of the following values: (null or '') to remove the lifecycle configuration. or a valid lifecycle configuration
   * `cb(error)` _function_ - callback function with `err` as the error argument. `err` is null if the operation is successful.
   */
  setBucketLifecycle(bucketName, lifeCycleConfig = null, cb) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (_.isEmpty(lifeCycleConfig)) {
      this.removeBucketLifecycle(bucketName, cb);
    } else {
      this.applyBucketLifecycle(bucketName, lifeCycleConfig, cb);
    }
  }

  /** Get lifecycle configuration on a bucket.
   * bucketName _string_
   * `cb(config)` _function_ - callback function with lifecycle configuration as the error argument.
   */
  getBucketLifecycle(bucketName, cb) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'lifecycle';
    const requestOptions = {
      method,
      bucketName,
      query
    };
    this.makeRequest(requestOptions, '', [200], '', true, (e, response) => {
      const transformer = transformers.lifecycleTransformer();
      if (e) {
        return cb(e);
      }
      let lifecycleConfig;
      pipesetup(response, transformer).on('data', result => lifecycleConfig = result).on('error', e => cb(e)).on('end', () => cb(null, lifecycleConfig));
    });
  }
  getObjectRetention(bucketName, objectName, getOpts, cb) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isObject(getOpts)) {
      throw new errors.InvalidArgumentError('callback should be of type "object"');
    } else if (getOpts.versionId && !isString(getOpts.versionId)) {
      throw new errors.InvalidArgumentError('VersionID should be of type "string"');
    }
    if (cb && !isFunction(cb)) {
      throw new errors.InvalidArgumentError('callback should be of type "function"');
    }
    const method = 'GET';
    let query = 'retention';
    if (getOpts.versionId) {
      query += `&versionId=${getOpts.versionId}`;
    }
    this.makeRequest({
      method,
      bucketName,
      objectName,
      query
    }, '', [200], '', true, (e, response) => {
      if (e) {
        return cb(e);
      }
      let retentionConfig = Buffer.from('');
      pipesetup(response, transformers.objectRetentionTransformer()).on('data', data => {
        retentionConfig = data;
      }).on('error', cb).on('end', () => {
        cb(null, retentionConfig);
      });
    });
  }
  setBucketEncryption(bucketName, encryptionConfig, cb) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (isFunction(encryptionConfig)) {
      cb = encryptionConfig;
      encryptionConfig = null;
    }
    if (!_.isEmpty(encryptionConfig) && encryptionConfig.Rule.length > 1) {
      throw new errors.InvalidArgumentError('Invalid Rule length. Only one rule is allowed.: ' + encryptionConfig.Rule);
    }
    if (cb && !isFunction(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    let encryptionObj = encryptionConfig;
    if (_.isEmpty(encryptionConfig)) {
      encryptionObj = {
        // Default MinIO Server Supported Rule
        Rule: [{
          ApplyServerSideEncryptionByDefault: {
            SSEAlgorithm: 'AES256'
          }
        }]
      };
    }
    let method = 'PUT';
    let query = 'encryption';
    let builder = new xml2js.Builder({
      rootName: 'ServerSideEncryptionConfiguration',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    let payload = builder.buildObject(encryptionObj);
    const headers = {};
    headers['Content-MD5'] = toMd5(payload);
    this.makeRequest({
      method,
      bucketName,
      query,
      headers
    }, payload, [200], '', false, cb);
  }
  getBucketEncryption(bucketName, cb) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isFunction(cb)) {
      throw new errors.InvalidArgumentError('callback should be of type "function"');
    }
    const method = 'GET';
    const query = 'encryption';
    this.makeRequest({
      method,
      bucketName,
      query
    }, '', [200], '', true, (e, response) => {
      if (e) {
        return cb(e);
      }
      let bucketEncConfig = Buffer.from('');
      pipesetup(response, transformers.bucketEncryptionTransformer()).on('data', data => {
        bucketEncConfig = data;
      }).on('error', cb).on('end', () => {
        cb(null, bucketEncConfig);
      });
    });
  }
  removeBucketEncryption(bucketName, cb) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isFunction(cb)) {
      throw new errors.InvalidArgumentError('callback should be of type "function"');
    }
    const method = 'DELETE';
    const query = 'encryption';
    this.makeRequest({
      method,
      bucketName,
      query
    }, '', [204], '', false, cb);
  }

  /**
   * Internal method to upload a part during compose object.
   * @param partConfig __object__ contains the following.
   *    bucketName __string__
   *    objectName __string__
   *    uploadID __string__
   *    partNumber __number__
   *    headers __object__
   * @param cb called with null incase of error.
   */
  uploadPartCopy(partConfig, cb) {
    const {
      bucketName,
      objectName,
      uploadID,
      partNumber,
      headers
    } = partConfig;
    const method = 'PUT';
    let query = `uploadId=${uploadID}&partNumber=${partNumber}`;
    const requestOptions = {
      method,
      bucketName,
      objectName: objectName,
      query,
      headers
    };
    return this.makeRequest(requestOptions, '', [200], '', true, (e, response) => {
      let partCopyResult = Buffer.from('');
      if (e) {
        return cb(e);
      }
      pipesetup(response, transformers.uploadPartTransformer()).on('data', data => {
        partCopyResult = data;
      }).on('error', cb).on('end', () => {
        let uploadPartCopyRes = {
          etag: sanitizeETag(partCopyResult.ETag),
          key: objectName,
          part: partNumber
        };
        cb(null, uploadPartCopyRes);
      });
    });
  }
  composeObject(destObjConfig = {}, sourceObjList = [], cb) {
    const me = this; // many async flows. so store the ref.
    const sourceFilesLength = sourceObjList.length;
    if (!Array.isArray(sourceObjList)) {
      throw new errors.InvalidArgumentError('sourceConfig should an array of CopySourceOptions ');
    }
    if (!(destObjConfig instanceof CopyDestinationOptions)) {
      throw new errors.InvalidArgumentError('destConfig should of type CopyDestinationOptions ');
    }
    if (sourceFilesLength < 1 || sourceFilesLength > PART_CONSTRAINTS.MAX_PARTS_COUNT) {
      throw new errors.InvalidArgumentError(`"There must be as least one and up to ${PART_CONSTRAINTS.MAX_PARTS_COUNT} source objects.`);
    }
    if (!isFunction(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    for (let i = 0; i < sourceFilesLength; i++) {
      if (!sourceObjList[i].validate()) {
        return false;
      }
    }
    if (!destObjConfig.validate()) {
      return false;
    }
    const getStatOptions = srcConfig => {
      let statOpts = {};
      if (!_.isEmpty(srcConfig.VersionID)) {
        statOpts = {
          versionId: srcConfig.VersionID
        };
      }
      return statOpts;
    };
    const srcObjectSizes = [];
    let totalSize = 0;
    let totalParts = 0;
    const sourceObjStats = sourceObjList.map(srcItem => me.statObject(srcItem.Bucket, srcItem.Object, getStatOptions(srcItem)));
    return Promise.all(sourceObjStats).then(srcObjectInfos => {
      const validatedStats = srcObjectInfos.map((resItemStat, index) => {
        const srcConfig = sourceObjList[index];
        let srcCopySize = resItemStat.size;
        // Check if a segment is specified, and if so, is the
        // segment within object bounds?
        if (srcConfig.MatchRange) {
          // Since range is specified,
          //    0 <= src.srcStart <= src.srcEnd
          // so only invalid case to check is:
          const srcStart = srcConfig.Start;
          const srcEnd = srcConfig.End;
          if (srcEnd >= srcCopySize || srcStart < 0) {
            throw new errors.InvalidArgumentError(`CopySrcOptions ${index} has invalid segment-to-copy [${srcStart}, ${srcEnd}] (size is ${srcCopySize})`);
          }
          srcCopySize = srcEnd - srcStart + 1;
        }

        // Only the last source may be less than `absMinPartSize`
        if (srcCopySize < PART_CONSTRAINTS.ABS_MIN_PART_SIZE && index < sourceFilesLength - 1) {
          throw new errors.InvalidArgumentError(`CopySrcOptions ${index} is too small (${srcCopySize}) and it is not the last part.`);
        }

        // Is data to copy too large?
        totalSize += srcCopySize;
        if (totalSize > PART_CONSTRAINTS.MAX_MULTIPART_PUT_OBJECT_SIZE) {
          throw new errors.InvalidArgumentError(`Cannot compose an object of size ${totalSize} (> 5TiB)`);
        }

        // record source size
        srcObjectSizes[index] = srcCopySize;

        // calculate parts needed for current source
        totalParts += partsRequired(srcCopySize);
        // Do we need more parts than we are allowed?
        if (totalParts > PART_CONSTRAINTS.MAX_PARTS_COUNT) {
          throw new errors.InvalidArgumentError(`Your proposed compose object requires more than ${PART_CONSTRAINTS.MAX_PARTS_COUNT} parts`);
        }
        return resItemStat;
      });
      if (totalParts === 1 && totalSize <= PART_CONSTRAINTS.MAX_PART_SIZE || totalSize === 0) {
        return this.copyObject(sourceObjList[0], destObjConfig, cb); // use copyObjectV2
      }

      // preserve etag to avoid modification of object while copying.
      for (let i = 0; i < sourceFilesLength; i++) {
        sourceObjList[i].MatchETag = validatedStats[i].etag;
      }
      const splitPartSizeList = validatedStats.map((resItemStat, idx) => {
        const calSize = calculateEvenSplits(srcObjectSizes[idx], sourceObjList[idx]);
        return calSize;
      });
      function getUploadPartConfigList(uploadId) {
        const uploadPartConfigList = [];
        splitPartSizeList.forEach((splitSize, splitIndex) => {
          const {
            startIndex: startIdx,
            endIndex: endIdx,
            objInfo: objConfig
          } = splitSize;
          let partIndex = splitIndex + 1; // part index starts from 1.
          const totalUploads = Array.from(startIdx);
          const headers = sourceObjList[splitIndex].getHeaders();
          totalUploads.forEach((splitStart, upldCtrIdx) => {
            let splitEnd = endIdx[upldCtrIdx];
            const sourceObj = `${objConfig.Bucket}/${objConfig.Object}`;
            headers['x-amz-copy-source'] = `${sourceObj}`;
            headers['x-amz-copy-source-range'] = `bytes=${splitStart}-${splitEnd}`;
            const uploadPartConfig = {
              bucketName: destObjConfig.Bucket,
              objectName: destObjConfig.Object,
              uploadID: uploadId,
              partNumber: partIndex,
              headers: headers,
              sourceObj: sourceObj
            };
            uploadPartConfigList.push(uploadPartConfig);
          });
        });
        return uploadPartConfigList;
      }
      const performUploadParts = uploadId => {
        const uploadList = getUploadPartConfigList(uploadId);
        async.map(uploadList, me.uploadPartCopy.bind(me), (err, res) => {
          if (err) {
            this.abortMultipartUpload(destObjConfig.Bucket, destObjConfig.Object, uploadId).then(() => cb(), err => cb(err));
            return;
          }
          const partsDone = res.map(partCopy => ({
            etag: partCopy.etag,
            part: partCopy.part
          }));
          return me.completeMultipartUpload(destObjConfig.Bucket, destObjConfig.Object, uploadId, partsDone).then(result => cb(null, result), err => cb(err));
        });
      };
      const newUploadHeaders = destObjConfig.getHeaders();
      me.initiateNewMultipartUpload(destObjConfig.Bucket, destObjConfig.Object, newUploadHeaders).then(uploadId => {
        performUploadParts(uploadId);
      }, err => {
        cb(err, null);
      });
    }).catch(error => {
      cb(error, null);
    });
  }
  selectObjectContent(bucketName, objectName, selectOpts = {}, cb) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!_.isEmpty(selectOpts)) {
      if (!isString(selectOpts.expression)) {
        throw new TypeError('sqlExpression should be of type "string"');
      }
      if (!_.isEmpty(selectOpts.inputSerialization)) {
        if (!isObject(selectOpts.inputSerialization)) {
          throw new TypeError('inputSerialization should be of type "object"');
        }
      } else {
        throw new TypeError('inputSerialization is required');
      }
      if (!_.isEmpty(selectOpts.outputSerialization)) {
        if (!isObject(selectOpts.outputSerialization)) {
          throw new TypeError('outputSerialization should be of type "object"');
        }
      } else {
        throw new TypeError('outputSerialization is required');
      }
    } else {
      throw new TypeError('valid select configuration is required');
    }
    if (!isFunction(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    const method = 'POST';
    let query = `select`;
    query += '&select-type=2';
    const config = [{
      Expression: selectOpts.expression
    }, {
      ExpressionType: selectOpts.expressionType || 'SQL'
    }, {
      InputSerialization: [selectOpts.inputSerialization]
    }, {
      OutputSerialization: [selectOpts.outputSerialization]
    }];

    // Optional
    if (selectOpts.requestProgress) {
      config.push({
        RequestProgress: selectOpts.requestProgress
      });
    }
    // Optional
    if (selectOpts.scanRange) {
      config.push({
        ScanRange: selectOpts.scanRange
      });
    }
    const builder = new xml2js.Builder({
      rootName: 'SelectObjectContentRequest',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(config);
    this.makeRequest({
      method,
      bucketName,
      objectName,
      query
    }, payload, [200], '', true, (e, response) => {
      if (e) {
        return cb(e);
      }
      let selectResult;
      pipesetup(response, transformers.selectObjectContentTransformer()).on('data', data => {
        selectResult = parseSelectObjectContentResponse(data);
      }).on('error', cb).on('end', () => {
        cb(null, selectResult);
      });
    });
  }
}

// Promisify various public-facing APIs on the Client module.
Client.prototype.copyObject = promisify(Client.prototype.copyObject);
Client.prototype.removeObjects = promisify(Client.prototype.removeObjects);
Client.prototype.presignedUrl = promisify(Client.prototype.presignedUrl);
Client.prototype.presignedGetObject = promisify(Client.prototype.presignedGetObject);
Client.prototype.presignedPutObject = promisify(Client.prototype.presignedPutObject);
Client.prototype.presignedPostPolicy = promisify(Client.prototype.presignedPostPolicy);
Client.prototype.getBucketNotification = promisify(Client.prototype.getBucketNotification);
Client.prototype.setBucketNotification = promisify(Client.prototype.setBucketNotification);
Client.prototype.removeAllBucketNotification = promisify(Client.prototype.removeAllBucketNotification);
Client.prototype.removeIncompleteUpload = promisify(Client.prototype.removeIncompleteUpload);
Client.prototype.setBucketTagging = promisify(Client.prototype.setBucketTagging);
Client.prototype.removeBucketTagging = promisify(Client.prototype.removeBucketTagging);
Client.prototype.setObjectTagging = promisify(Client.prototype.setObjectTagging);
Client.prototype.removeObjectTagging = promisify(Client.prototype.removeObjectTagging);
Client.prototype.setBucketLifecycle = promisify(Client.prototype.setBucketLifecycle);
Client.prototype.getBucketLifecycle = promisify(Client.prototype.getBucketLifecycle);
Client.prototype.removeBucketLifecycle = promisify(Client.prototype.removeBucketLifecycle);
Client.prototype.getObjectRetention = promisify(Client.prototype.getObjectRetention);
Client.prototype.setBucketEncryption = promisify(Client.prototype.setBucketEncryption);
Client.prototype.getBucketEncryption = promisify(Client.prototype.getBucketEncryption);
Client.prototype.removeBucketEncryption = promisify(Client.prototype.removeBucketEncryption);
Client.prototype.composeObject = promisify(Client.prototype.composeObject);
Client.prototype.selectObjectContent = promisify(Client.prototype.selectObjectContent);

// refactored API use promise internally
Client.prototype.makeBucket = callbackify(Client.prototype.makeBucket);
Client.prototype.bucketExists = callbackify(Client.prototype.bucketExists);
Client.prototype.removeBucket = callbackify(Client.prototype.removeBucket);
Client.prototype.listBuckets = callbackify(Client.prototype.listBuckets);
Client.prototype.getObject = callbackify(Client.prototype.getObject);
Client.prototype.fGetObject = callbackify(Client.prototype.fGetObject);
Client.prototype.getPartialObject = callbackify(Client.prototype.getPartialObject);
Client.prototype.statObject = callbackify(Client.prototype.statObject);
Client.prototype.putObjectRetention = callbackify(Client.prototype.putObjectRetention);
Client.prototype.putObject = callbackify(Client.prototype.putObject);
Client.prototype.fPutObject = callbackify(Client.prototype.fPutObject);
Client.prototype.removeObject = callbackify(Client.prototype.removeObject);
Client.prototype.removeBucketReplication = callbackify(Client.prototype.removeBucketReplication);
Client.prototype.setBucketReplication = callbackify(Client.prototype.setBucketReplication);
Client.prototype.getBucketReplication = callbackify(Client.prototype.getBucketReplication);
Client.prototype.getObjectLegalHold = callbackify(Client.prototype.getObjectLegalHold);
Client.prototype.setObjectLegalHold = callbackify(Client.prototype.setObjectLegalHold);
Client.prototype.getBucketTagging = callbackify(Client.prototype.getBucketTagging);
Client.prototype.getObjectTagging = callbackify(Client.prototype.getObjectTagging);
Client.prototype.setObjectLockConfig = callbackify(Client.prototype.setObjectLockConfig);
Client.prototype.getObjectLockConfig = callbackify(Client.prototype.getObjectLockConfig);
Client.prototype.getBucketPolicy = callbackify(Client.prototype.getBucketPolicy);
Client.prototype.setBucketPolicy = callbackify(Client.prototype.setBucketPolicy);
Client.prototype.getBucketVersioning = callbackify(Client.prototype.getBucketVersioning);
Client.prototype.setBucketVersioning = callbackify(Client.prototype.setBucketVersioning);
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJTdHJlYW0iLCJhc3luYyIsIl8iLCJxdWVyeXN0cmluZyIsIlRleHRFbmNvZGVyIiwieG1sMmpzIiwiZXJyb3JzIiwiQ29weURlc3RpbmF0aW9uT3B0aW9ucyIsIkNvcHlTb3VyY2VPcHRpb25zIiwiY2FsbGJhY2tpZnkiLCJUeXBlZENsaWVudCIsIkNvcHlDb25kaXRpb25zIiwiY2FsY3VsYXRlRXZlblNwbGl0cyIsImV4dHJhY3RNZXRhZGF0YSIsImdldFNjb3BlIiwiZ2V0U291cmNlVmVyc2lvbklkIiwiZ2V0VmVyc2lvbklkIiwiaXNCb29sZWFuIiwiaXNGdW5jdGlvbiIsImlzTnVtYmVyIiwiaXNPYmplY3QiLCJpc1N0cmluZyIsImlzVmFsaWRCdWNrZXROYW1lIiwiaXNWYWxpZERhdGUiLCJpc1ZhbGlkT2JqZWN0TmFtZSIsImlzVmFsaWRQcmVmaXgiLCJtYWtlRGF0ZUxvbmciLCJQQVJUX0NPTlNUUkFJTlRTIiwicGFydHNSZXF1aXJlZCIsInBpcGVzZXR1cCIsInNhbml0aXplRVRhZyIsInRvTWQ1IiwidXJpRXNjYXBlIiwidXJpUmVzb3VyY2VFc2NhcGUiLCJQb3N0UG9saWN5IiwiTm90aWZpY2F0aW9uQ29uZmlnIiwiTm90aWZpY2F0aW9uUG9sbGVyIiwicHJvbWlzaWZ5IiwicG9zdFByZXNpZ25TaWduYXR1cmVWNCIsInByZXNpZ25TaWduYXR1cmVWNCIsInRyYW5zZm9ybWVycyIsInBhcnNlU2VsZWN0T2JqZWN0Q29udGVudFJlc3BvbnNlIiwiQ2xpZW50Iiwic2V0QXBwSW5mbyIsImFwcE5hbWUiLCJhcHBWZXJzaW9uIiwiVHlwZUVycm9yIiwidHJpbSIsIkludmFsaWRBcmd1bWVudEVycm9yIiwidXNlckFnZW50IiwicmVtb3ZlSW5jb21wbGV0ZVVwbG9hZCIsImJ1Y2tldE5hbWUiLCJvYmplY3ROYW1lIiwiY2IiLCJJc1ZhbGlkQnVja2V0TmFtZUVycm9yIiwiSW52YWxpZE9iamVjdE5hbWVFcnJvciIsInJlbW92ZVVwbG9hZElkIiwiZHVyaW5nIiwiZmluZFVwbG9hZElkIiwidGhlbiIsInVwbG9hZElkIiwibWV0aG9kIiwicXVlcnkiLCJtYWtlUmVxdWVzdCIsImUiLCJjb3B5T2JqZWN0VjEiLCJhcmcxIiwiYXJnMiIsImFyZzMiLCJhcmc0IiwiYXJnNSIsInNyY09iamVjdCIsImNvbmRpdGlvbnMiLCJ1bmRlZmluZWQiLCJJbnZhbGlkQnVja2V0TmFtZUVycm9yIiwiSW52YWxpZFByZWZpeEVycm9yIiwiaGVhZGVycyIsIm1vZGlmaWVkIiwidW5tb2RpZmllZCIsIm1hdGNoRVRhZyIsIm1hdGNoRXRhZ0V4Y2VwdCIsIm1hdGNoRVRhZ0V4Y2VwdCIsInJlc3BvbnNlIiwidHJhbnNmb3JtZXIiLCJnZXRDb3B5T2JqZWN0VHJhbnNmb3JtZXIiLCJvbiIsImRhdGEiLCJjb3B5T2JqZWN0VjIiLCJzb3VyY2VDb25maWciLCJkZXN0Q29uZmlnIiwidmFsaWRhdGUiLCJPYmplY3QiLCJhc3NpZ24iLCJnZXRIZWFkZXJzIiwiQnVja2V0IiwicmVzSGVhZGVycyIsImNvcHlPYmpSZXNwb25zZSIsIktleSIsIkxhc3RNb2RpZmllZCIsIk1ldGFEYXRhIiwiVmVyc2lvbklkIiwiU291cmNlVmVyc2lvbklkIiwiRXRhZyIsImV0YWciLCJTaXplIiwiY29weU9iamVjdCIsImFsbEFyZ3MiLCJhcmd1bWVudHMiLCJsaXN0T2JqZWN0c1F1ZXJ5IiwicHJlZml4IiwibWFya2VyIiwibGlzdFF1ZXJ5T3B0cyIsIkRlbGltaXRlciIsIk1heEtleXMiLCJJbmNsdWRlVmVyc2lvbiIsInF1ZXJpZXMiLCJwdXNoIiwic29ydCIsImxlbmd0aCIsImpvaW4iLCJnZXRMaXN0T2JqZWN0c1RyYW5zZm9ybWVyIiwiZW1pdCIsImxpc3RPYmplY3RzIiwicmVjdXJzaXZlIiwibGlzdE9wdHMiLCJvYmplY3RzIiwiZW5kZWQiLCJyZWFkU3RyZWFtIiwiUmVhZGFibGUiLCJvYmplY3RNb2RlIiwiX3JlYWQiLCJzaGlmdCIsInJlc3VsdCIsImlzVHJ1bmNhdGVkIiwibmV4dE1hcmtlciIsInZlcnNpb25JZE1hcmtlciIsImxpc3RPYmplY3RzVjJRdWVyeSIsImNvbnRpbnVhdGlvblRva2VuIiwiZGVsaW1pdGVyIiwibWF4S2V5cyIsInN0YXJ0QWZ0ZXIiLCJnZXRMaXN0T2JqZWN0c1YyVHJhbnNmb3JtZXIiLCJsaXN0T2JqZWN0c1YyIiwibmV4dENvbnRpbnVhdGlvblRva2VuIiwicmVtb3ZlT2JqZWN0cyIsIm9iamVjdHNMaXN0IiwiQXJyYXkiLCJpc0FycmF5IiwibWF4RW50cmllcyIsInJlZHVjZSIsImVudHJ5IiwibGlzdCIsImxpc3RPZkxpc3QiLCJlbmNvZGVyIiwiYmF0Y2hSZXN1bHRzIiwiZWFjaFNlcmllcyIsImJhdGNoQ2IiLCJmb3JFYWNoIiwidmFsdWUiLCJuYW1lIiwidmVyc2lvbklkIiwiZGVsZXRlT2JqZWN0cyIsIkRlbGV0ZSIsIlF1aWV0IiwiYnVpbGRlciIsIkJ1aWxkZXIiLCJoZWFkbGVzcyIsInBheWxvYWQiLCJidWlsZE9iamVjdCIsIkJ1ZmZlciIsImZyb20iLCJlbmNvZGUiLCJyZW1vdmVPYmplY3RzUmVzdWx0IiwicmVtb3ZlT2JqZWN0c1RyYW5zZm9ybWVyIiwiZmxhdHRlbiIsInByZXNpZ25lZFVybCIsImV4cGlyZXMiLCJyZXFQYXJhbXMiLCJyZXF1ZXN0RGF0ZSIsImFub255bW91cyIsIkFub255bW91c1JlcXVlc3RFcnJvciIsIkRhdGUiLCJzdHJpbmdpZnkiLCJnZXRCdWNrZXRSZWdpb24iLCJyZWdpb24iLCJ1cmwiLCJyZXFPcHRpb25zIiwiZ2V0UmVxdWVzdE9wdGlvbnMiLCJjaGVja0FuZFJlZnJlc2hDcmVkcyIsImFjY2Vzc0tleSIsInNlY3JldEtleSIsInNlc3Npb25Ub2tlbiIsInBlIiwicHJlc2lnbmVkR2V0T2JqZWN0IiwicmVzcEhlYWRlcnMiLCJ2YWxpZFJlc3BIZWFkZXJzIiwiaGVhZGVyIiwicHJlc2lnbmVkUHV0T2JqZWN0IiwibmV3UG9zdFBvbGljeSIsInByZXNpZ25lZFBvc3RQb2xpY3kiLCJwb3N0UG9saWN5IiwiZm9ybURhdGEiLCJidWNrZXQiLCJkYXRlIiwiZGF0ZVN0ciIsInBvbGljeSIsImV4cGlyYXRpb24iLCJzZXRTZWNvbmRzIiwic2V0RXhwaXJlcyIsInBvbGljeUJhc2U2NCIsIkpTT04iLCJ0b1N0cmluZyIsInNpZ25hdHVyZSIsIm9wdHMiLCJwb3J0U3RyIiwicG9ydCIsInVybFN0ciIsInByb3RvY29sIiwiaG9zdCIsInBhdGgiLCJwb3N0VVJMIiwic2V0QnVja2V0Tm90aWZpY2F0aW9uIiwiY29uZmlnIiwicm9vdE5hbWUiLCJyZW5kZXJPcHRzIiwicHJldHR5IiwicmVtb3ZlQWxsQnVja2V0Tm90aWZpY2F0aW9uIiwiZ2V0QnVja2V0Tm90aWZpY2F0aW9uIiwiZ2V0QnVja2V0Tm90aWZpY2F0aW9uVHJhbnNmb3JtZXIiLCJidWNrZXROb3RpZmljYXRpb24iLCJsaXN0ZW5CdWNrZXROb3RpZmljYXRpb24iLCJzdWZmaXgiLCJldmVudHMiLCJsaXN0ZW5lciIsInN0YXJ0Iiwic2V0VGFnZ2luZyIsInRhZ2dpbmdQYXJhbXMiLCJ0YWdzIiwicHV0T3B0cyIsInRhZ3NMaXN0Iiwia2V5IiwiZW50cmllcyIsIlZhbHVlIiwidGFnZ2luZ0NvbmZpZyIsIlRhZ2dpbmciLCJUYWdTZXQiLCJUYWciLCJyZXF1ZXN0T3B0aW9ucyIsInNldEJ1Y2tldFRhZ2dpbmciLCJrZXlzIiwic2V0T2JqZWN0VGFnZ2luZyIsInJlbW92ZVRhZ2dpbmciLCJyZW1vdmVPcHRzIiwicmVtb3ZlQnVja2V0VGFnZ2luZyIsInJlbW92ZU9iamVjdFRhZ2dpbmciLCJhcHBseUJ1Y2tldExpZmVjeWNsZSIsInBvbGljeUNvbmZpZyIsInJlbW92ZUJ1Y2tldExpZmVjeWNsZSIsInNldEJ1Y2tldExpZmVjeWNsZSIsImxpZmVDeWNsZUNvbmZpZyIsImlzRW1wdHkiLCJnZXRCdWNrZXRMaWZlY3ljbGUiLCJsaWZlY3ljbGVUcmFuc2Zvcm1lciIsImxpZmVjeWNsZUNvbmZpZyIsImdldE9iamVjdFJldGVudGlvbiIsImdldE9wdHMiLCJyZXRlbnRpb25Db25maWciLCJvYmplY3RSZXRlbnRpb25UcmFuc2Zvcm1lciIsInNldEJ1Y2tldEVuY3J5cHRpb24iLCJlbmNyeXB0aW9uQ29uZmlnIiwiUnVsZSIsImVuY3J5cHRpb25PYmoiLCJBcHBseVNlcnZlclNpZGVFbmNyeXB0aW9uQnlEZWZhdWx0IiwiU1NFQWxnb3JpdGhtIiwiZ2V0QnVja2V0RW5jcnlwdGlvbiIsImJ1Y2tldEVuY0NvbmZpZyIsImJ1Y2tldEVuY3J5cHRpb25UcmFuc2Zvcm1lciIsInJlbW92ZUJ1Y2tldEVuY3J5cHRpb24iLCJ1cGxvYWRQYXJ0Q29weSIsInBhcnRDb25maWciLCJ1cGxvYWRJRCIsInBhcnROdW1iZXIiLCJwYXJ0Q29weVJlc3VsdCIsInVwbG9hZFBhcnRUcmFuc2Zvcm1lciIsInVwbG9hZFBhcnRDb3B5UmVzIiwiRVRhZyIsInBhcnQiLCJjb21wb3NlT2JqZWN0IiwiZGVzdE9iakNvbmZpZyIsInNvdXJjZU9iakxpc3QiLCJtZSIsInNvdXJjZUZpbGVzTGVuZ3RoIiwiTUFYX1BBUlRTX0NPVU5UIiwiaSIsImdldFN0YXRPcHRpb25zIiwic3JjQ29uZmlnIiwic3RhdE9wdHMiLCJWZXJzaW9uSUQiLCJzcmNPYmplY3RTaXplcyIsInRvdGFsU2l6ZSIsInRvdGFsUGFydHMiLCJzb3VyY2VPYmpTdGF0cyIsIm1hcCIsInNyY0l0ZW0iLCJzdGF0T2JqZWN0IiwiUHJvbWlzZSIsImFsbCIsInNyY09iamVjdEluZm9zIiwidmFsaWRhdGVkU3RhdHMiLCJyZXNJdGVtU3RhdCIsImluZGV4Iiwic3JjQ29weVNpemUiLCJzaXplIiwiTWF0Y2hSYW5nZSIsInNyY1N0YXJ0IiwiU3RhcnQiLCJzcmNFbmQiLCJFbmQiLCJBQlNfTUlOX1BBUlRfU0laRSIsIk1BWF9NVUxUSVBBUlRfUFVUX09CSkVDVF9TSVpFIiwiTUFYX1BBUlRfU0laRSIsIk1hdGNoRVRhZyIsInNwbGl0UGFydFNpemVMaXN0IiwiaWR4IiwiY2FsU2l6ZSIsImdldFVwbG9hZFBhcnRDb25maWdMaXN0IiwidXBsb2FkUGFydENvbmZpZ0xpc3QiLCJzcGxpdFNpemUiLCJzcGxpdEluZGV4Iiwic3RhcnRJbmRleCIsInN0YXJ0SWR4IiwiZW5kSW5kZXgiLCJlbmRJZHgiLCJvYmpJbmZvIiwib2JqQ29uZmlnIiwicGFydEluZGV4IiwidG90YWxVcGxvYWRzIiwic3BsaXRTdGFydCIsInVwbGRDdHJJZHgiLCJzcGxpdEVuZCIsInNvdXJjZU9iaiIsInVwbG9hZFBhcnRDb25maWciLCJwZXJmb3JtVXBsb2FkUGFydHMiLCJ1cGxvYWRMaXN0IiwiYmluZCIsImVyciIsInJlcyIsImFib3J0TXVsdGlwYXJ0VXBsb2FkIiwicGFydHNEb25lIiwicGFydENvcHkiLCJjb21wbGV0ZU11bHRpcGFydFVwbG9hZCIsIm5ld1VwbG9hZEhlYWRlcnMiLCJpbml0aWF0ZU5ld011bHRpcGFydFVwbG9hZCIsImNhdGNoIiwiZXJyb3IiLCJzZWxlY3RPYmplY3RDb250ZW50Iiwic2VsZWN0T3B0cyIsImV4cHJlc3Npb24iLCJpbnB1dFNlcmlhbGl6YXRpb24iLCJvdXRwdXRTZXJpYWxpemF0aW9uIiwiRXhwcmVzc2lvbiIsIkV4cHJlc3Npb25UeXBlIiwiZXhwcmVzc2lvblR5cGUiLCJJbnB1dFNlcmlhbGl6YXRpb24iLCJPdXRwdXRTZXJpYWxpemF0aW9uIiwicmVxdWVzdFByb2dyZXNzIiwiUmVxdWVzdFByb2dyZXNzIiwic2NhblJhbmdlIiwiU2NhblJhbmdlIiwic2VsZWN0UmVzdWx0Iiwic2VsZWN0T2JqZWN0Q29udGVudFRyYW5zZm9ybWVyIiwicHJvdG90eXBlIiwibWFrZUJ1Y2tldCIsImJ1Y2tldEV4aXN0cyIsInJlbW92ZUJ1Y2tldCIsImxpc3RCdWNrZXRzIiwiZ2V0T2JqZWN0IiwiZkdldE9iamVjdCIsImdldFBhcnRpYWxPYmplY3QiLCJwdXRPYmplY3RSZXRlbnRpb24iLCJwdXRPYmplY3QiLCJmUHV0T2JqZWN0IiwicmVtb3ZlT2JqZWN0IiwicmVtb3ZlQnVja2V0UmVwbGljYXRpb24iLCJzZXRCdWNrZXRSZXBsaWNhdGlvbiIsImdldEJ1Y2tldFJlcGxpY2F0aW9uIiwiZ2V0T2JqZWN0TGVnYWxIb2xkIiwic2V0T2JqZWN0TGVnYWxIb2xkIiwiZ2V0QnVja2V0VGFnZ2luZyIsImdldE9iamVjdFRhZ2dpbmciLCJzZXRPYmplY3RMb2NrQ29uZmlnIiwiZ2V0T2JqZWN0TG9ja0NvbmZpZyIsImdldEJ1Y2tldFBvbGljeSIsInNldEJ1Y2tldFBvbGljeSIsImdldEJ1Y2tldFZlcnNpb25pbmciLCJzZXRCdWNrZXRWZXJzaW9uaW5nIl0sInNvdXJjZXMiOlsibWluaW8uanMiXSwic291cmNlc0NvbnRlbnQiOlsiLypcbiAqIE1pbklPIEphdmFzY3JpcHQgTGlicmFyeSBmb3IgQW1hem9uIFMzIENvbXBhdGlibGUgQ2xvdWQgU3RvcmFnZSwgKEMpIDIwMTUgTWluSU8sIEluYy5cbiAqXG4gKiBMaWNlbnNlZCB1bmRlciB0aGUgQXBhY2hlIExpY2Vuc2UsIFZlcnNpb24gMi4wICh0aGUgXCJMaWNlbnNlXCIpO1xuICogeW91IG1heSBub3QgdXNlIHRoaXMgZmlsZSBleGNlcHQgaW4gY29tcGxpYW5jZSB3aXRoIHRoZSBMaWNlbnNlLlxuICogWW91IG1heSBvYnRhaW4gYSBjb3B5IG9mIHRoZSBMaWNlbnNlIGF0XG4gKlxuICogICAgIGh0dHA6Ly93d3cuYXBhY2hlLm9yZy9saWNlbnNlcy9MSUNFTlNFLTIuMFxuICpcbiAqIFVubGVzcyByZXF1aXJlZCBieSBhcHBsaWNhYmxlIGxhdyBvciBhZ3JlZWQgdG8gaW4gd3JpdGluZywgc29mdHdhcmVcbiAqIGRpc3RyaWJ1dGVkIHVuZGVyIHRoZSBMaWNlbnNlIGlzIGRpc3RyaWJ1dGVkIG9uIGFuIFwiQVMgSVNcIiBCQVNJUyxcbiAqIFdJVEhPVVQgV0FSUkFOVElFUyBPUiBDT05ESVRJT05TIE9GIEFOWSBLSU5ELCBlaXRoZXIgZXhwcmVzcyBvciBpbXBsaWVkLlxuICogU2VlIHRoZSBMaWNlbnNlIGZvciB0aGUgc3BlY2lmaWMgbGFuZ3VhZ2UgZ292ZXJuaW5nIHBlcm1pc3Npb25zIGFuZFxuICogbGltaXRhdGlvbnMgdW5kZXIgdGhlIExpY2Vuc2UuXG4gKi9cblxuaW1wb3J0ICogYXMgU3RyZWFtIGZyb20gJ25vZGU6c3RyZWFtJ1xuXG5pbXBvcnQgYXN5bmMgZnJvbSAnYXN5bmMnXG5pbXBvcnQgXyBmcm9tICdsb2Rhc2gnXG5pbXBvcnQgKiBhcyBxdWVyeXN0cmluZyBmcm9tICdxdWVyeS1zdHJpbmcnXG5pbXBvcnQgeyBUZXh0RW5jb2RlciB9IGZyb20gJ3dlYi1lbmNvZGluZydcbmltcG9ydCB4bWwyanMgZnJvbSAneG1sMmpzJ1xuXG5pbXBvcnQgKiBhcyBlcnJvcnMgZnJvbSAnLi9lcnJvcnMudHMnXG5pbXBvcnQgeyBDb3B5RGVzdGluYXRpb25PcHRpb25zLCBDb3B5U291cmNlT3B0aW9ucyB9IGZyb20gJy4vaGVscGVycy50cydcbmltcG9ydCB7IGNhbGxiYWNraWZ5IH0gZnJvbSAnLi9pbnRlcm5hbC9jYWxsYmFja2lmeS5qcydcbmltcG9ydCB7IFR5cGVkQ2xpZW50IH0gZnJvbSAnLi9pbnRlcm5hbC9jbGllbnQudHMnXG5pbXBvcnQgeyBDb3B5Q29uZGl0aW9ucyB9IGZyb20gJy4vaW50ZXJuYWwvY29weS1jb25kaXRpb25zLnRzJ1xuaW1wb3J0IHtcbiAgY2FsY3VsYXRlRXZlblNwbGl0cyxcbiAgZXh0cmFjdE1ldGFkYXRhLFxuICBnZXRTY29wZSxcbiAgZ2V0U291cmNlVmVyc2lvbklkLFxuICBnZXRWZXJzaW9uSWQsXG4gIGlzQm9vbGVhbixcbiAgaXNGdW5jdGlvbixcbiAgaXNOdW1iZXIsXG4gIGlzT2JqZWN0LFxuICBpc1N0cmluZyxcbiAgaXNWYWxpZEJ1Y2tldE5hbWUsXG4gIGlzVmFsaWREYXRlLFxuICBpc1ZhbGlkT2JqZWN0TmFtZSxcbiAgaXNWYWxpZFByZWZpeCxcbiAgbWFrZURhdGVMb25nLFxuICBQQVJUX0NPTlNUUkFJTlRTLFxuICBwYXJ0c1JlcXVpcmVkLFxuICBwaXBlc2V0dXAsXG4gIHNhbml0aXplRVRhZyxcbiAgdG9NZDUsXG4gIHVyaUVzY2FwZSxcbiAgdXJpUmVzb3VyY2VFc2NhcGUsXG59IGZyb20gJy4vaW50ZXJuYWwvaGVscGVyLnRzJ1xuaW1wb3J0IHsgUG9zdFBvbGljeSB9IGZyb20gJy4vaW50ZXJuYWwvcG9zdC1wb2xpY3kudHMnXG5pbXBvcnQgeyBOb3RpZmljYXRpb25Db25maWcsIE5vdGlmaWNhdGlvblBvbGxlciB9IGZyb20gJy4vbm90aWZpY2F0aW9uLnRzJ1xuaW1wb3J0IHsgcHJvbWlzaWZ5IH0gZnJvbSAnLi9wcm9taXNpZnkuanMnXG5pbXBvcnQgeyBwb3N0UHJlc2lnblNpZ25hdHVyZVY0LCBwcmVzaWduU2lnbmF0dXJlVjQgfSBmcm9tICcuL3NpZ25pbmcudHMnXG5pbXBvcnQgKiBhcyB0cmFuc2Zvcm1lcnMgZnJvbSAnLi90cmFuc2Zvcm1lcnMuanMnXG5pbXBvcnQgeyBwYXJzZVNlbGVjdE9iamVjdENvbnRlbnRSZXNwb25zZSB9IGZyb20gJy4veG1sLXBhcnNlcnMuanMnXG5cbmV4cG9ydCAqIGZyb20gJy4vZXJyb3JzLnRzJ1xuZXhwb3J0ICogZnJvbSAnLi9oZWxwZXJzLnRzJ1xuZXhwb3J0ICogZnJvbSAnLi9ub3RpZmljYXRpb24udHMnXG5leHBvcnQgeyBDb3B5Q29uZGl0aW9ucywgUG9zdFBvbGljeSB9XG5cbmV4cG9ydCBjbGFzcyBDbGllbnQgZXh0ZW5kcyBUeXBlZENsaWVudCB7XG4gIC8vIFNldCBhcHBsaWNhdGlvbiBzcGVjaWZpYyBpbmZvcm1hdGlvbi5cbiAgLy9cbiAgLy8gR2VuZXJhdGVzIFVzZXItQWdlbnQgaW4gdGhlIGZvbGxvd2luZyBzdHlsZS5cbiAgLy9cbiAgLy8gICAgICAgTWluSU8gKE9TOyBBUkNIKSBMSUIvVkVSIEFQUC9WRVJcbiAgLy9cbiAgLy8gX19Bcmd1bWVudHNfX1xuICAvLyAqIGBhcHBOYW1lYCBfc3RyaW5nXyAtIEFwcGxpY2F0aW9uIG5hbWUuXG4gIC8vICogYGFwcFZlcnNpb25gIF9zdHJpbmdfIC0gQXBwbGljYXRpb24gdmVyc2lvbi5cbiAgc2V0QXBwSW5mbyhhcHBOYW1lLCBhcHBWZXJzaW9uKSB7XG4gICAgaWYgKCFpc1N0cmluZyhhcHBOYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgSW52YWxpZCBhcHBOYW1lOiAke2FwcE5hbWV9YClcbiAgICB9XG4gICAgaWYgKGFwcE5hbWUudHJpbSgpID09PSAnJykge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignSW5wdXQgYXBwTmFtZSBjYW5ub3QgYmUgZW1wdHkuJylcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhhcHBWZXJzaW9uKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgSW52YWxpZCBhcHBWZXJzaW9uOiAke2FwcFZlcnNpb259YClcbiAgICB9XG4gICAgaWYgKGFwcFZlcnNpb24udHJpbSgpID09PSAnJykge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignSW5wdXQgYXBwVmVyc2lvbiBjYW5ub3QgYmUgZW1wdHkuJylcbiAgICB9XG4gICAgdGhpcy51c2VyQWdlbnQgPSBgJHt0aGlzLnVzZXJBZ2VudH0gJHthcHBOYW1lfS8ke2FwcFZlcnNpb259YFxuICB9XG5cbiAgLy8gUmVtb3ZlIHRoZSBwYXJ0aWFsbHkgdXBsb2FkZWQgb2JqZWN0LlxuICAvL1xuICAvLyBfX0FyZ3VtZW50c19fXG4gIC8vICogYGJ1Y2tldE5hbWVgIF9zdHJpbmdfOiBuYW1lIG9mIHRoZSBidWNrZXRcbiAgLy8gKiBgb2JqZWN0TmFtZWAgX3N0cmluZ186IG5hbWUgb2YgdGhlIG9iamVjdFxuICAvLyAqIGBjYWxsYmFjayhlcnIpYCBfZnVuY3Rpb25fOiBjYWxsYmFjayBmdW5jdGlvbiBpcyBjYWxsZWQgd2l0aCBub24gYG51bGxgIHZhbHVlIGluIGNhc2Ugb2YgZXJyb3JcbiAgcmVtb3ZlSW5jb21wbGV0ZVVwbG9hZChidWNrZXROYW1lLCBvYmplY3ROYW1lLCBjYikge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSXNWYWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNGdW5jdGlvbihjYikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2NhbGxiYWNrIHNob3VsZCBiZSBvZiB0eXBlIFwiZnVuY3Rpb25cIicpXG4gICAgfVxuICAgIHZhciByZW1vdmVVcGxvYWRJZFxuICAgIGFzeW5jLmR1cmluZyhcbiAgICAgIChjYikgPT4ge1xuICAgICAgICB0aGlzLmZpbmRVcGxvYWRJZChidWNrZXROYW1lLCBvYmplY3ROYW1lKS50aGVuKCh1cGxvYWRJZCkgPT4ge1xuICAgICAgICAgIHJlbW92ZVVwbG9hZElkID0gdXBsb2FkSWRcbiAgICAgICAgICBjYihudWxsLCB1cGxvYWRJZClcbiAgICAgICAgfSwgY2IpXG4gICAgICB9LFxuICAgICAgKGNiKSA9PiB7XG4gICAgICAgIHZhciBtZXRob2QgPSAnREVMRVRFJ1xuICAgICAgICB2YXIgcXVlcnkgPSBgdXBsb2FkSWQ9JHtyZW1vdmVVcGxvYWRJZH1gXG4gICAgICAgIHRoaXMubWFrZVJlcXVlc3QoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHF1ZXJ5IH0sICcnLCBbMjA0XSwgJycsIGZhbHNlLCAoZSkgPT4gY2IoZSkpXG4gICAgICB9LFxuICAgICAgY2IsXG4gICAgKVxuICB9XG5cbiAgLy8gQ29weSB0aGUgb2JqZWN0LlxuICAvL1xuICAvLyBfX0FyZ3VtZW50c19fXG4gIC8vICogYGJ1Y2tldE5hbWVgIF9zdHJpbmdfOiBuYW1lIG9mIHRoZSBidWNrZXRcbiAgLy8gKiBgb2JqZWN0TmFtZWAgX3N0cmluZ186IG5hbWUgb2YgdGhlIG9iamVjdFxuICAvLyAqIGBzcmNPYmplY3RgIF9zdHJpbmdfOiBwYXRoIG9mIHRoZSBzb3VyY2Ugb2JqZWN0IHRvIGJlIGNvcGllZFxuICAvLyAqIGBjb25kaXRpb25zYCBfQ29weUNvbmRpdGlvbnNfOiBjb3B5IGNvbmRpdGlvbnMgdGhhdCBuZWVkcyB0byBiZSBzYXRpc2ZpZWQgKG9wdGlvbmFsLCBkZWZhdWx0IGBudWxsYClcbiAgLy8gKiBgY2FsbGJhY2soZXJyLCB7ZXRhZywgbGFzdE1vZGlmaWVkfSlgIF9mdW5jdGlvbl86IG5vbiBudWxsIGBlcnJgIGluZGljYXRlcyBlcnJvciwgYGV0YWdgIF9zdHJpbmdfIGFuZCBgbGlzdE1vZGlmZWRgIF9EYXRlXyBhcmUgcmVzcGVjdGl2ZWx5IHRoZSBldGFnIGFuZCB0aGUgbGFzdCBtb2RpZmllZCBkYXRlIG9mIHRoZSBuZXdseSBjb3BpZWQgb2JqZWN0XG4gIGNvcHlPYmplY3RWMShhcmcxLCBhcmcyLCBhcmczLCBhcmc0LCBhcmc1KSB7XG4gICAgdmFyIGJ1Y2tldE5hbWUgPSBhcmcxXG4gICAgdmFyIG9iamVjdE5hbWUgPSBhcmcyXG4gICAgdmFyIHNyY09iamVjdCA9IGFyZzNcbiAgICB2YXIgY29uZGl0aW9ucywgY2JcbiAgICBpZiAodHlwZW9mIGFyZzQgPT0gJ2Z1bmN0aW9uJyAmJiBhcmc1ID09PSB1bmRlZmluZWQpIHtcbiAgICAgIGNvbmRpdGlvbnMgPSBudWxsXG4gICAgICBjYiA9IGFyZzRcbiAgICB9IGVsc2Uge1xuICAgICAgY29uZGl0aW9ucyA9IGFyZzRcbiAgICAgIGNiID0gYXJnNVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHNyY09iamVjdCkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3NyY09iamVjdCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKHNyY09iamVjdCA9PT0gJycpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZFByZWZpeEVycm9yKGBFbXB0eSBzb3VyY2UgcHJlZml4YClcbiAgICB9XG5cbiAgICBpZiAoY29uZGl0aW9ucyAhPT0gbnVsbCAmJiAhKGNvbmRpdGlvbnMgaW5zdGFuY2VvZiBDb3B5Q29uZGl0aW9ucykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2NvbmRpdGlvbnMgc2hvdWxkIGJlIG9mIHR5cGUgXCJDb3B5Q29uZGl0aW9uc1wiJylcbiAgICB9XG5cbiAgICB2YXIgaGVhZGVycyA9IHt9XG4gICAgaGVhZGVyc1sneC1hbXotY29weS1zb3VyY2UnXSA9IHVyaVJlc291cmNlRXNjYXBlKHNyY09iamVjdClcblxuICAgIGlmIChjb25kaXRpb25zICE9PSBudWxsKSB7XG4gICAgICBpZiAoY29uZGl0aW9ucy5tb2RpZmllZCAhPT0gJycpIHtcbiAgICAgICAgaGVhZGVyc1sneC1hbXotY29weS1zb3VyY2UtaWYtbW9kaWZpZWQtc2luY2UnXSA9IGNvbmRpdGlvbnMubW9kaWZpZWRcbiAgICAgIH1cbiAgICAgIGlmIChjb25kaXRpb25zLnVubW9kaWZpZWQgIT09ICcnKSB7XG4gICAgICAgIGhlYWRlcnNbJ3gtYW16LWNvcHktc291cmNlLWlmLXVubW9kaWZpZWQtc2luY2UnXSA9IGNvbmRpdGlvbnMudW5tb2RpZmllZFxuICAgICAgfVxuICAgICAgaWYgKGNvbmRpdGlvbnMubWF0Y2hFVGFnICE9PSAnJykge1xuICAgICAgICBoZWFkZXJzWyd4LWFtei1jb3B5LXNvdXJjZS1pZi1tYXRjaCddID0gY29uZGl0aW9ucy5tYXRjaEVUYWdcbiAgICAgIH1cbiAgICAgIGlmIChjb25kaXRpb25zLm1hdGNoRXRhZ0V4Y2VwdCAhPT0gJycpIHtcbiAgICAgICAgaGVhZGVyc1sneC1hbXotY29weS1zb3VyY2UtaWYtbm9uZS1tYXRjaCddID0gY29uZGl0aW9ucy5tYXRjaEVUYWdFeGNlcHRcbiAgICAgIH1cbiAgICB9XG5cbiAgICB2YXIgbWV0aG9kID0gJ1BVVCdcbiAgICB0aGlzLm1ha2VSZXF1ZXN0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBoZWFkZXJzIH0sICcnLCBbMjAwXSwgJycsIHRydWUsIChlLCByZXNwb25zZSkgPT4ge1xuICAgICAgaWYgKGUpIHtcbiAgICAgICAgcmV0dXJuIGNiKGUpXG4gICAgICB9XG4gICAgICB2YXIgdHJhbnNmb3JtZXIgPSB0cmFuc2Zvcm1lcnMuZ2V0Q29weU9iamVjdFRyYW5zZm9ybWVyKClcbiAgICAgIHBpcGVzZXR1cChyZXNwb25zZSwgdHJhbnNmb3JtZXIpXG4gICAgICAgIC5vbignZXJyb3InLCAoZSkgPT4gY2IoZSkpXG4gICAgICAgIC5vbignZGF0YScsIChkYXRhKSA9PiBjYihudWxsLCBkYXRhKSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEludGVybmFsIE1ldGhvZCB0byBwZXJmb3JtIGNvcHkgb2YgYW4gb2JqZWN0LlxuICAgKiBAcGFyYW0gc291cmNlQ29uZmlnIF9fb2JqZWN0X18gICBpbnN0YW5jZSBvZiBDb3B5U291cmNlT3B0aW9ucyBAbGluayAuL2hlbHBlcnMvQ29weVNvdXJjZU9wdGlvbnNcbiAgICogQHBhcmFtIGRlc3RDb25maWcgIF9fb2JqZWN0X18gICBpbnN0YW5jZSBvZiBDb3B5RGVzdGluYXRpb25PcHRpb25zIEBsaW5rIC4vaGVscGVycy9Db3B5RGVzdGluYXRpb25PcHRpb25zXG4gICAqIEBwYXJhbSBjYiBfX2Z1bmN0aW9uX18gY2FsbGVkIHdpdGggbnVsbCBpZiB0aGVyZSBpcyBhbiBlcnJvclxuICAgKiBAcmV0dXJucyBQcm9taXNlIGlmIG5vIGNhbGxhY2sgaXMgcGFzc2VkLlxuICAgKi9cbiAgY29weU9iamVjdFYyKHNvdXJjZUNvbmZpZywgZGVzdENvbmZpZywgY2IpIHtcbiAgICBpZiAoIShzb3VyY2VDb25maWcgaW5zdGFuY2VvZiBDb3B5U291cmNlT3B0aW9ucykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3NvdXJjZUNvbmZpZyBzaG91bGQgb2YgdHlwZSBDb3B5U291cmNlT3B0aW9ucyAnKVxuICAgIH1cbiAgICBpZiAoIShkZXN0Q29uZmlnIGluc3RhbmNlb2YgQ29weURlc3RpbmF0aW9uT3B0aW9ucykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ2Rlc3RDb25maWcgc2hvdWxkIG9mIHR5cGUgQ29weURlc3RpbmF0aW9uT3B0aW9ucyAnKVxuICAgIH1cbiAgICBpZiAoIWRlc3RDb25maWcudmFsaWRhdGUoKSkge1xuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuICAgIGlmICghZGVzdENvbmZpZy52YWxpZGF0ZSgpKSB7XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG4gICAgaWYgKCFpc0Z1bmN0aW9uKGNiKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignY2FsbGJhY2sgc2hvdWxkIGJlIG9mIHR5cGUgXCJmdW5jdGlvblwiJylcbiAgICB9XG5cbiAgICBjb25zdCBoZWFkZXJzID0gT2JqZWN0LmFzc2lnbih7fSwgc291cmNlQ29uZmlnLmdldEhlYWRlcnMoKSwgZGVzdENvbmZpZy5nZXRIZWFkZXJzKCkpXG5cbiAgICBjb25zdCBidWNrZXROYW1lID0gZGVzdENvbmZpZy5CdWNrZXRcbiAgICBjb25zdCBvYmplY3ROYW1lID0gZGVzdENvbmZpZy5PYmplY3RcblxuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXG4gICAgdGhpcy5tYWtlUmVxdWVzdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgaGVhZGVycyB9LCAnJywgWzIwMF0sICcnLCB0cnVlLCAoZSwgcmVzcG9uc2UpID0+IHtcbiAgICAgIGlmIChlKSB7XG4gICAgICAgIHJldHVybiBjYihlKVxuICAgICAgfVxuICAgICAgY29uc3QgdHJhbnNmb3JtZXIgPSB0cmFuc2Zvcm1lcnMuZ2V0Q29weU9iamVjdFRyYW5zZm9ybWVyKClcbiAgICAgIHBpcGVzZXR1cChyZXNwb25zZSwgdHJhbnNmb3JtZXIpXG4gICAgICAgIC5vbignZXJyb3InLCAoZSkgPT4gY2IoZSkpXG4gICAgICAgIC5vbignZGF0YScsIChkYXRhKSA9PiB7XG4gICAgICAgICAgY29uc3QgcmVzSGVhZGVycyA9IHJlc3BvbnNlLmhlYWRlcnNcblxuICAgICAgICAgIGNvbnN0IGNvcHlPYmpSZXNwb25zZSA9IHtcbiAgICAgICAgICAgIEJ1Y2tldDogZGVzdENvbmZpZy5CdWNrZXQsXG4gICAgICAgICAgICBLZXk6IGRlc3RDb25maWcuT2JqZWN0LFxuICAgICAgICAgICAgTGFzdE1vZGlmaWVkOiBkYXRhLkxhc3RNb2RpZmllZCxcbiAgICAgICAgICAgIE1ldGFEYXRhOiBleHRyYWN0TWV0YWRhdGEocmVzSGVhZGVycyksXG4gICAgICAgICAgICBWZXJzaW9uSWQ6IGdldFZlcnNpb25JZChyZXNIZWFkZXJzKSxcbiAgICAgICAgICAgIFNvdXJjZVZlcnNpb25JZDogZ2V0U291cmNlVmVyc2lvbklkKHJlc0hlYWRlcnMpLFxuICAgICAgICAgICAgRXRhZzogc2FuaXRpemVFVGFnKHJlc0hlYWRlcnMuZXRhZyksXG4gICAgICAgICAgICBTaXplOiArcmVzSGVhZGVyc1snY29udGVudC1sZW5ndGgnXSxcbiAgICAgICAgICB9XG5cbiAgICAgICAgICByZXR1cm4gY2IobnVsbCwgY29weU9ialJlc3BvbnNlKVxuICAgICAgICB9KVxuICAgIH0pXG4gIH1cblxuICAvLyBCYWNrd2FyZCBjb21wYXRpYmlsaXR5IGZvciBDb3B5IE9iamVjdCBBUEkuXG4gIGNvcHlPYmplY3QoLi4uYWxsQXJncykge1xuICAgIGlmIChhbGxBcmdzWzBdIGluc3RhbmNlb2YgQ29weVNvdXJjZU9wdGlvbnMgJiYgYWxsQXJnc1sxXSBpbnN0YW5jZW9mIENvcHlEZXN0aW5hdGlvbk9wdGlvbnMpIHtcbiAgICAgIHJldHVybiB0aGlzLmNvcHlPYmplY3RWMiguLi5hcmd1bWVudHMpXG4gICAgfVxuICAgIHJldHVybiB0aGlzLmNvcHlPYmplY3RWMSguLi5hcmd1bWVudHMpXG4gIH1cblxuICAvLyBsaXN0IGEgYmF0Y2ggb2Ygb2JqZWN0c1xuICBsaXN0T2JqZWN0c1F1ZXJ5KGJ1Y2tldE5hbWUsIHByZWZpeCwgbWFya2VyLCBsaXN0UXVlcnlPcHRzID0ge30pIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHByZWZpeCkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3ByZWZpeCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhtYXJrZXIpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdtYXJrZXIgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGxldCB7IERlbGltaXRlciwgTWF4S2V5cywgSW5jbHVkZVZlcnNpb24gfSA9IGxpc3RRdWVyeU9wdHNcblxuICAgIGlmICghaXNPYmplY3QobGlzdFF1ZXJ5T3B0cykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2xpc3RRdWVyeU9wdHMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuXG4gICAgaWYgKCFpc1N0cmluZyhEZWxpbWl0ZXIpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdEZWxpbWl0ZXIgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmICghaXNOdW1iZXIoTWF4S2V5cykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ01heEtleXMgc2hvdWxkIGJlIG9mIHR5cGUgXCJudW1iZXJcIicpXG4gICAgfVxuXG4gICAgY29uc3QgcXVlcmllcyA9IFtdXG4gICAgLy8gZXNjYXBlIGV2ZXJ5IHZhbHVlIGluIHF1ZXJ5IHN0cmluZywgZXhjZXB0IG1heEtleXNcbiAgICBxdWVyaWVzLnB1c2goYHByZWZpeD0ke3VyaUVzY2FwZShwcmVmaXgpfWApXG4gICAgcXVlcmllcy5wdXNoKGBkZWxpbWl0ZXI9JHt1cmlFc2NhcGUoRGVsaW1pdGVyKX1gKVxuICAgIHF1ZXJpZXMucHVzaChgZW5jb2RpbmctdHlwZT11cmxgKVxuXG4gICAgaWYgKEluY2x1ZGVWZXJzaW9uKSB7XG4gICAgICBxdWVyaWVzLnB1c2goYHZlcnNpb25zYClcbiAgICB9XG5cbiAgICBpZiAobWFya2VyKSB7XG4gICAgICBtYXJrZXIgPSB1cmlFc2NhcGUobWFya2VyKVxuICAgICAgaWYgKEluY2x1ZGVWZXJzaW9uKSB7XG4gICAgICAgIHF1ZXJpZXMucHVzaChga2V5LW1hcmtlcj0ke21hcmtlcn1gKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcXVlcmllcy5wdXNoKGBtYXJrZXI9JHttYXJrZXJ9YClcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBubyBuZWVkIHRvIGVzY2FwZSBtYXhLZXlzXG4gICAgaWYgKE1heEtleXMpIHtcbiAgICAgIGlmIChNYXhLZXlzID49IDEwMDApIHtcbiAgICAgICAgTWF4S2V5cyA9IDEwMDBcbiAgICAgIH1cbiAgICAgIHF1ZXJpZXMucHVzaChgbWF4LWtleXM9JHtNYXhLZXlzfWApXG4gICAgfVxuICAgIHF1ZXJpZXMuc29ydCgpXG4gICAgdmFyIHF1ZXJ5ID0gJydcbiAgICBpZiAocXVlcmllcy5sZW5ndGggPiAwKSB7XG4gICAgICBxdWVyeSA9IGAke3F1ZXJpZXMuam9pbignJicpfWBcbiAgICB9XG5cbiAgICB2YXIgbWV0aG9kID0gJ0dFVCdcbiAgICB2YXIgdHJhbnNmb3JtZXIgPSB0cmFuc2Zvcm1lcnMuZ2V0TGlzdE9iamVjdHNUcmFuc2Zvcm1lcigpXG4gICAgdGhpcy5tYWtlUmVxdWVzdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSwgJycsIFsyMDBdLCAnJywgdHJ1ZSwgKGUsIHJlc3BvbnNlKSA9PiB7XG4gICAgICBpZiAoZSkge1xuICAgICAgICByZXR1cm4gdHJhbnNmb3JtZXIuZW1pdCgnZXJyb3InLCBlKVxuICAgICAgfVxuICAgICAgcGlwZXNldHVwKHJlc3BvbnNlLCB0cmFuc2Zvcm1lcilcbiAgICB9KVxuICAgIHJldHVybiB0cmFuc2Zvcm1lclxuICB9XG5cbiAgLy8gTGlzdCB0aGUgb2JqZWN0cyBpbiB0aGUgYnVja2V0LlxuICAvL1xuICAvLyBfX0FyZ3VtZW50c19fXG4gIC8vICogYGJ1Y2tldE5hbWVgIF9zdHJpbmdfOiBuYW1lIG9mIHRoZSBidWNrZXRcbiAgLy8gKiBgcHJlZml4YCBfc3RyaW5nXzogdGhlIHByZWZpeCBvZiB0aGUgb2JqZWN0cyB0aGF0IHNob3VsZCBiZSBsaXN0ZWQgKG9wdGlvbmFsLCBkZWZhdWx0IGAnJ2ApXG4gIC8vICogYHJlY3Vyc2l2ZWAgX2Jvb2xfOiBgdHJ1ZWAgaW5kaWNhdGVzIHJlY3Vyc2l2ZSBzdHlsZSBsaXN0aW5nIGFuZCBgZmFsc2VgIGluZGljYXRlcyBkaXJlY3Rvcnkgc3R5bGUgbGlzdGluZyBkZWxpbWl0ZWQgYnkgJy8nLiAob3B0aW9uYWwsIGRlZmF1bHQgYGZhbHNlYClcbiAgLy8gKiBgbGlzdE9wdHMgX29iamVjdF86IHF1ZXJ5IHBhcmFtcyB0byBsaXN0IG9iamVjdCB3aXRoIGJlbG93IGtleXNcbiAgLy8gKiAgICBsaXN0T3B0cy5NYXhLZXlzIF9pbnRfIG1heGltdW0gbnVtYmVyIG9mIGtleXMgdG8gcmV0dXJuXG4gIC8vICogICAgbGlzdE9wdHMuSW5jbHVkZVZlcnNpb24gIF9ib29sXyB0cnVlfGZhbHNlIHRvIGluY2x1ZGUgdmVyc2lvbnMuXG4gIC8vIF9fUmV0dXJuIFZhbHVlX19cbiAgLy8gKiBgc3RyZWFtYCBfU3RyZWFtXzogc3RyZWFtIGVtaXR0aW5nIHRoZSBvYmplY3RzIGluIHRoZSBidWNrZXQsIHRoZSBvYmplY3QgaXMgb2YgdGhlIGZvcm1hdDpcbiAgLy8gKiBgb2JqLm5hbWVgIF9zdHJpbmdfOiBuYW1lIG9mIHRoZSBvYmplY3RcbiAgLy8gKiBgb2JqLnByZWZpeGAgX3N0cmluZ186IG5hbWUgb2YgdGhlIG9iamVjdCBwcmVmaXhcbiAgLy8gKiBgb2JqLnNpemVgIF9udW1iZXJfOiBzaXplIG9mIHRoZSBvYmplY3RcbiAgLy8gKiBgb2JqLmV0YWdgIF9zdHJpbmdfOiBldGFnIG9mIHRoZSBvYmplY3RcbiAgLy8gKiBgb2JqLmxhc3RNb2RpZmllZGAgX0RhdGVfOiBtb2RpZmllZCB0aW1lIHN0YW1wXG4gIC8vICogYG9iai5pc0RlbGV0ZU1hcmtlcmAgX2Jvb2xlYW5fOiB0cnVlIGlmIGl0IGlzIGEgZGVsZXRlIG1hcmtlclxuICAvLyAqIGBvYmoudmVyc2lvbklkYCBfc3RyaW5nXzogdmVyc2lvbklkIG9mIHRoZSBvYmplY3RcbiAgbGlzdE9iamVjdHMoYnVja2V0TmFtZSwgcHJlZml4LCByZWN1cnNpdmUsIGxpc3RPcHRzID0ge30pIHtcbiAgICBpZiAocHJlZml4ID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHByZWZpeCA9ICcnXG4gICAgfVxuICAgIGlmIChyZWN1cnNpdmUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgcmVjdXJzaXZlID0gZmFsc2VcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkUHJlZml4KHByZWZpeCkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZFByZWZpeEVycm9yKGBJbnZhbGlkIHByZWZpeCA6ICR7cHJlZml4fWApXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcocHJlZml4KSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncHJlZml4IHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoIWlzQm9vbGVhbihyZWN1cnNpdmUpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZWN1cnNpdmUgc2hvdWxkIGJlIG9mIHR5cGUgXCJib29sZWFuXCInKVxuICAgIH1cbiAgICBpZiAoIWlzT2JqZWN0KGxpc3RPcHRzKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbGlzdE9wdHMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuICAgIHZhciBtYXJrZXIgPSAnJ1xuICAgIGNvbnN0IGxpc3RRdWVyeU9wdHMgPSB7XG4gICAgICBEZWxpbWl0ZXI6IHJlY3Vyc2l2ZSA/ICcnIDogJy8nLCAvLyBpZiByZWN1cnNpdmUgaXMgZmFsc2Ugc2V0IGRlbGltaXRlciB0byAnLydcbiAgICAgIE1heEtleXM6IDEwMDAsXG4gICAgICBJbmNsdWRlVmVyc2lvbjogbGlzdE9wdHMuSW5jbHVkZVZlcnNpb24sXG4gICAgfVxuICAgIHZhciBvYmplY3RzID0gW11cbiAgICB2YXIgZW5kZWQgPSBmYWxzZVxuICAgIHZhciByZWFkU3RyZWFtID0gU3RyZWFtLlJlYWRhYmxlKHsgb2JqZWN0TW9kZTogdHJ1ZSB9KVxuICAgIHJlYWRTdHJlYW0uX3JlYWQgPSAoKSA9PiB7XG4gICAgICAvLyBwdXNoIG9uZSBvYmplY3QgcGVyIF9yZWFkKClcbiAgICAgIGlmIChvYmplY3RzLmxlbmd0aCkge1xuICAgICAgICByZWFkU3RyZWFtLnB1c2gob2JqZWN0cy5zaGlmdCgpKVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cbiAgICAgIGlmIChlbmRlZCkge1xuICAgICAgICByZXR1cm4gcmVhZFN0cmVhbS5wdXNoKG51bGwpXG4gICAgICB9XG4gICAgICAvLyBpZiB0aGVyZSBhcmUgbm8gb2JqZWN0cyB0byBwdXNoIGRvIHF1ZXJ5IGZvciB0aGUgbmV4dCBiYXRjaCBvZiBvYmplY3RzXG4gICAgICB0aGlzLmxpc3RPYmplY3RzUXVlcnkoYnVja2V0TmFtZSwgcHJlZml4LCBtYXJrZXIsIGxpc3RRdWVyeU9wdHMpXG4gICAgICAgIC5vbignZXJyb3InLCAoZSkgPT4gcmVhZFN0cmVhbS5lbWl0KCdlcnJvcicsIGUpKVxuICAgICAgICAub24oJ2RhdGEnLCAocmVzdWx0KSA9PiB7XG4gICAgICAgICAgaWYgKHJlc3VsdC5pc1RydW5jYXRlZCkge1xuICAgICAgICAgICAgbWFya2VyID0gcmVzdWx0Lm5leHRNYXJrZXIgfHwgcmVzdWx0LnZlcnNpb25JZE1hcmtlclxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBlbmRlZCA9IHRydWVcbiAgICAgICAgICB9XG4gICAgICAgICAgb2JqZWN0cyA9IHJlc3VsdC5vYmplY3RzXG4gICAgICAgICAgcmVhZFN0cmVhbS5fcmVhZCgpXG4gICAgICAgIH0pXG4gICAgfVxuICAgIHJldHVybiByZWFkU3RyZWFtXG4gIH1cblxuICAvLyBsaXN0T2JqZWN0c1YyUXVlcnkgLSAoTGlzdCBPYmplY3RzIFYyKSAtIExpc3Qgc29tZSBvciBhbGwgKHVwIHRvIDEwMDApIG9mIHRoZSBvYmplY3RzIGluIGEgYnVja2V0LlxuICAvL1xuICAvLyBZb3UgY2FuIHVzZSB0aGUgcmVxdWVzdCBwYXJhbWV0ZXJzIGFzIHNlbGVjdGlvbiBjcml0ZXJpYSB0byByZXR1cm4gYSBzdWJzZXQgb2YgdGhlIG9iamVjdHMgaW4gYSBidWNrZXQuXG4gIC8vIHJlcXVlc3QgcGFyYW1ldGVycyA6LVxuICAvLyAqIGBidWNrZXROYW1lYCBfc3RyaW5nXzogbmFtZSBvZiB0aGUgYnVja2V0XG4gIC8vICogYHByZWZpeGAgX3N0cmluZ186IExpbWl0cyB0aGUgcmVzcG9uc2UgdG8ga2V5cyB0aGF0IGJlZ2luIHdpdGggdGhlIHNwZWNpZmllZCBwcmVmaXguXG4gIC8vICogYGNvbnRpbnVhdGlvbi10b2tlbmAgX3N0cmluZ186IFVzZWQgdG8gY29udGludWUgaXRlcmF0aW5nIG92ZXIgYSBzZXQgb2Ygb2JqZWN0cy5cbiAgLy8gKiBgZGVsaW1pdGVyYCBfc3RyaW5nXzogQSBkZWxpbWl0ZXIgaXMgYSBjaGFyYWN0ZXIgeW91IHVzZSB0byBncm91cCBrZXlzLlxuICAvLyAqIGBtYXgta2V5c2AgX251bWJlcl86IFNldHMgdGhlIG1heGltdW0gbnVtYmVyIG9mIGtleXMgcmV0dXJuZWQgaW4gdGhlIHJlc3BvbnNlIGJvZHkuXG4gIC8vICogYHN0YXJ0LWFmdGVyYCBfc3RyaW5nXzogU3BlY2lmaWVzIHRoZSBrZXkgdG8gc3RhcnQgYWZ0ZXIgd2hlbiBsaXN0aW5nIG9iamVjdHMgaW4gYSBidWNrZXQuXG4gIGxpc3RPYmplY3RzVjJRdWVyeShidWNrZXROYW1lLCBwcmVmaXgsIGNvbnRpbnVhdGlvblRva2VuLCBkZWxpbWl0ZXIsIG1heEtleXMsIHN0YXJ0QWZ0ZXIpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHByZWZpeCkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3ByZWZpeCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhjb250aW51YXRpb25Ub2tlbikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2NvbnRpbnVhdGlvblRva2VuIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKGRlbGltaXRlcikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2RlbGltaXRlciBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKCFpc051bWJlcihtYXhLZXlzKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbWF4S2V5cyBzaG91bGQgYmUgb2YgdHlwZSBcIm51bWJlclwiJylcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhzdGFydEFmdGVyKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignc3RhcnRBZnRlciBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgdmFyIHF1ZXJpZXMgPSBbXVxuXG4gICAgLy8gQ2FsbCBmb3IgbGlzdGluZyBvYmplY3RzIHYyIEFQSVxuICAgIHF1ZXJpZXMucHVzaChgbGlzdC10eXBlPTJgKVxuICAgIHF1ZXJpZXMucHVzaChgZW5jb2RpbmctdHlwZT11cmxgKVxuXG4gICAgLy8gZXNjYXBlIGV2ZXJ5IHZhbHVlIGluIHF1ZXJ5IHN0cmluZywgZXhjZXB0IG1heEtleXNcbiAgICBxdWVyaWVzLnB1c2goYHByZWZpeD0ke3VyaUVzY2FwZShwcmVmaXgpfWApXG4gICAgcXVlcmllcy5wdXNoKGBkZWxpbWl0ZXI9JHt1cmlFc2NhcGUoZGVsaW1pdGVyKX1gKVxuXG4gICAgaWYgKGNvbnRpbnVhdGlvblRva2VuKSB7XG4gICAgICBjb250aW51YXRpb25Ub2tlbiA9IHVyaUVzY2FwZShjb250aW51YXRpb25Ub2tlbilcbiAgICAgIHF1ZXJpZXMucHVzaChgY29udGludWF0aW9uLXRva2VuPSR7Y29udGludWF0aW9uVG9rZW59YClcbiAgICB9XG4gICAgLy8gU2V0IHN0YXJ0LWFmdGVyXG4gICAgaWYgKHN0YXJ0QWZ0ZXIpIHtcbiAgICAgIHN0YXJ0QWZ0ZXIgPSB1cmlFc2NhcGUoc3RhcnRBZnRlcilcbiAgICAgIHF1ZXJpZXMucHVzaChgc3RhcnQtYWZ0ZXI9JHtzdGFydEFmdGVyfWApXG4gICAgfVxuICAgIC8vIG5vIG5lZWQgdG8gZXNjYXBlIG1heEtleXNcbiAgICBpZiAobWF4S2V5cykge1xuICAgICAgaWYgKG1heEtleXMgPj0gMTAwMCkge1xuICAgICAgICBtYXhLZXlzID0gMTAwMFxuICAgICAgfVxuICAgICAgcXVlcmllcy5wdXNoKGBtYXgta2V5cz0ke21heEtleXN9YClcbiAgICB9XG4gICAgcXVlcmllcy5zb3J0KClcbiAgICB2YXIgcXVlcnkgPSAnJ1xuICAgIGlmIChxdWVyaWVzLmxlbmd0aCA+IDApIHtcbiAgICAgIHF1ZXJ5ID0gYCR7cXVlcmllcy5qb2luKCcmJyl9YFxuICAgIH1cbiAgICB2YXIgbWV0aG9kID0gJ0dFVCdcbiAgICB2YXIgdHJhbnNmb3JtZXIgPSB0cmFuc2Zvcm1lcnMuZ2V0TGlzdE9iamVjdHNWMlRyYW5zZm9ybWVyKClcbiAgICB0aGlzLm1ha2VSZXF1ZXN0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9LCAnJywgWzIwMF0sICcnLCB0cnVlLCAoZSwgcmVzcG9uc2UpID0+IHtcbiAgICAgIGlmIChlKSB7XG4gICAgICAgIHJldHVybiB0cmFuc2Zvcm1lci5lbWl0KCdlcnJvcicsIGUpXG4gICAgICB9XG4gICAgICBwaXBlc2V0dXAocmVzcG9uc2UsIHRyYW5zZm9ybWVyKVxuICAgIH0pXG4gICAgcmV0dXJuIHRyYW5zZm9ybWVyXG4gIH1cblxuICAvLyBMaXN0IHRoZSBvYmplY3RzIGluIHRoZSBidWNrZXQgdXNpbmcgUzMgTGlzdE9iamVjdHMgVjJcbiAgLy9cbiAgLy8gX19Bcmd1bWVudHNfX1xuICAvLyAqIGBidWNrZXROYW1lYCBfc3RyaW5nXzogbmFtZSBvZiB0aGUgYnVja2V0XG4gIC8vICogYHByZWZpeGAgX3N0cmluZ186IHRoZSBwcmVmaXggb2YgdGhlIG9iamVjdHMgdGhhdCBzaG91bGQgYmUgbGlzdGVkIChvcHRpb25hbCwgZGVmYXVsdCBgJydgKVxuICAvLyAqIGByZWN1cnNpdmVgIF9ib29sXzogYHRydWVgIGluZGljYXRlcyByZWN1cnNpdmUgc3R5bGUgbGlzdGluZyBhbmQgYGZhbHNlYCBpbmRpY2F0ZXMgZGlyZWN0b3J5IHN0eWxlIGxpc3RpbmcgZGVsaW1pdGVkIGJ5ICcvJy4gKG9wdGlvbmFsLCBkZWZhdWx0IGBmYWxzZWApXG4gIC8vICogYHN0YXJ0QWZ0ZXJgIF9zdHJpbmdfOiBTcGVjaWZpZXMgdGhlIGtleSB0byBzdGFydCBhZnRlciB3aGVuIGxpc3Rpbmcgb2JqZWN0cyBpbiBhIGJ1Y2tldC4gKG9wdGlvbmFsLCBkZWZhdWx0IGAnJ2ApXG4gIC8vXG4gIC8vIF9fUmV0dXJuIFZhbHVlX19cbiAgLy8gKiBgc3RyZWFtYCBfU3RyZWFtXzogc3RyZWFtIGVtaXR0aW5nIHRoZSBvYmplY3RzIGluIHRoZSBidWNrZXQsIHRoZSBvYmplY3QgaXMgb2YgdGhlIGZvcm1hdDpcbiAgLy8gICAqIGBvYmoubmFtZWAgX3N0cmluZ186IG5hbWUgb2YgdGhlIG9iamVjdFxuICAvLyAgICogYG9iai5wcmVmaXhgIF9zdHJpbmdfOiBuYW1lIG9mIHRoZSBvYmplY3QgcHJlZml4XG4gIC8vICAgKiBgb2JqLnNpemVgIF9udW1iZXJfOiBzaXplIG9mIHRoZSBvYmplY3RcbiAgLy8gICAqIGBvYmouZXRhZ2AgX3N0cmluZ186IGV0YWcgb2YgdGhlIG9iamVjdFxuICAvLyAgICogYG9iai5sYXN0TW9kaWZpZWRgIF9EYXRlXzogbW9kaWZpZWQgdGltZSBzdGFtcFxuICBsaXN0T2JqZWN0c1YyKGJ1Y2tldE5hbWUsIHByZWZpeCwgcmVjdXJzaXZlLCBzdGFydEFmdGVyKSB7XG4gICAgaWYgKHByZWZpeCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBwcmVmaXggPSAnJ1xuICAgIH1cbiAgICBpZiAocmVjdXJzaXZlID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHJlY3Vyc2l2ZSA9IGZhbHNlXG4gICAgfVxuICAgIGlmIChzdGFydEFmdGVyID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHN0YXJ0QWZ0ZXIgPSAnJ1xuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRQcmVmaXgocHJlZml4KSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkUHJlZml4RXJyb3IoYEludmFsaWQgcHJlZml4IDogJHtwcmVmaXh9YClcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhwcmVmaXgpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdwcmVmaXggc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmICghaXNCb29sZWFuKHJlY3Vyc2l2ZSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3JlY3Vyc2l2ZSBzaG91bGQgYmUgb2YgdHlwZSBcImJvb2xlYW5cIicpXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcoc3RhcnRBZnRlcikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3N0YXJ0QWZ0ZXIgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIC8vIGlmIHJlY3Vyc2l2ZSBpcyBmYWxzZSBzZXQgZGVsaW1pdGVyIHRvICcvJ1xuICAgIHZhciBkZWxpbWl0ZXIgPSByZWN1cnNpdmUgPyAnJyA6ICcvJ1xuICAgIHZhciBjb250aW51YXRpb25Ub2tlbiA9ICcnXG4gICAgdmFyIG9iamVjdHMgPSBbXVxuICAgIHZhciBlbmRlZCA9IGZhbHNlXG4gICAgdmFyIHJlYWRTdHJlYW0gPSBTdHJlYW0uUmVhZGFibGUoeyBvYmplY3RNb2RlOiB0cnVlIH0pXG4gICAgcmVhZFN0cmVhbS5fcmVhZCA9ICgpID0+IHtcbiAgICAgIC8vIHB1c2ggb25lIG9iamVjdCBwZXIgX3JlYWQoKVxuICAgICAgaWYgKG9iamVjdHMubGVuZ3RoKSB7XG4gICAgICAgIHJlYWRTdHJlYW0ucHVzaChvYmplY3RzLnNoaWZ0KCkpXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuICAgICAgaWYgKGVuZGVkKSB7XG4gICAgICAgIHJldHVybiByZWFkU3RyZWFtLnB1c2gobnVsbClcbiAgICAgIH1cbiAgICAgIC8vIGlmIHRoZXJlIGFyZSBubyBvYmplY3RzIHRvIHB1c2ggZG8gcXVlcnkgZm9yIHRoZSBuZXh0IGJhdGNoIG9mIG9iamVjdHNcbiAgICAgIHRoaXMubGlzdE9iamVjdHNWMlF1ZXJ5KGJ1Y2tldE5hbWUsIHByZWZpeCwgY29udGludWF0aW9uVG9rZW4sIGRlbGltaXRlciwgMTAwMCwgc3RhcnRBZnRlcilcbiAgICAgICAgLm9uKCdlcnJvcicsIChlKSA9PiByZWFkU3RyZWFtLmVtaXQoJ2Vycm9yJywgZSkpXG4gICAgICAgIC5vbignZGF0YScsIChyZXN1bHQpID0+IHtcbiAgICAgICAgICBpZiAocmVzdWx0LmlzVHJ1bmNhdGVkKSB7XG4gICAgICAgICAgICBjb250aW51YXRpb25Ub2tlbiA9IHJlc3VsdC5uZXh0Q29udGludWF0aW9uVG9rZW5cbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZW5kZWQgPSB0cnVlXG4gICAgICAgICAgfVxuICAgICAgICAgIG9iamVjdHMgPSByZXN1bHQub2JqZWN0c1xuICAgICAgICAgIHJlYWRTdHJlYW0uX3JlYWQoKVxuICAgICAgICB9KVxuICAgIH1cbiAgICByZXR1cm4gcmVhZFN0cmVhbVxuICB9XG5cbiAgLy8gUmVtb3ZlIGFsbCB0aGUgb2JqZWN0cyByZXNpZGluZyBpbiB0aGUgb2JqZWN0c0xpc3QuXG4gIC8vXG4gIC8vIF9fQXJndW1lbnRzX19cbiAgLy8gKiBgYnVja2V0TmFtZWAgX3N0cmluZ186IG5hbWUgb2YgdGhlIGJ1Y2tldFxuICAvLyAqIGBvYmplY3RzTGlzdGAgX2FycmF5XzogYXJyYXkgb2Ygb2JqZWN0cyBvZiBvbmUgb2YgdGhlIGZvbGxvd2luZzpcbiAgLy8gKiAgICAgICAgIExpc3Qgb2YgT2JqZWN0IG5hbWVzIGFzIGFycmF5IG9mIHN0cmluZ3Mgd2hpY2ggYXJlIG9iamVjdCBrZXlzOiAgWydvYmplY3RuYW1lMScsJ29iamVjdG5hbWUyJ11cbiAgLy8gKiAgICAgICAgIExpc3Qgb2YgT2JqZWN0IG5hbWUgYW5kIHZlcnNpb25JZCBhcyBhbiBvYmplY3Q6ICBbe25hbWU6XCJvYmplY3RuYW1lXCIsdmVyc2lvbklkOlwibXktdmVyc2lvbi1pZFwifV1cblxuICByZW1vdmVPYmplY3RzKGJ1Y2tldE5hbWUsIG9iamVjdHNMaXN0LCBjYikge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghQXJyYXkuaXNBcnJheShvYmplY3RzTGlzdCkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ29iamVjdHNMaXN0IHNob3VsZCBiZSBhIGxpc3QnKVxuICAgIH1cbiAgICBpZiAoIWlzRnVuY3Rpb24oY2IpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdjYWxsYmFjayBzaG91bGQgYmUgb2YgdHlwZSBcImZ1bmN0aW9uXCInKVxuICAgIH1cblxuICAgIGNvbnN0IG1heEVudHJpZXMgPSAxMDAwXG4gICAgY29uc3QgcXVlcnkgPSAnZGVsZXRlJ1xuICAgIGNvbnN0IG1ldGhvZCA9ICdQT1NUJ1xuXG4gICAgbGV0IHJlc3VsdCA9IG9iamVjdHNMaXN0LnJlZHVjZShcbiAgICAgIChyZXN1bHQsIGVudHJ5KSA9PiB7XG4gICAgICAgIHJlc3VsdC5saXN0LnB1c2goZW50cnkpXG4gICAgICAgIGlmIChyZXN1bHQubGlzdC5sZW5ndGggPT09IG1heEVudHJpZXMpIHtcbiAgICAgICAgICByZXN1bHQubGlzdE9mTGlzdC5wdXNoKHJlc3VsdC5saXN0KVxuICAgICAgICAgIHJlc3VsdC5saXN0ID0gW11cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcmVzdWx0XG4gICAgICB9LFxuICAgICAgeyBsaXN0T2ZMaXN0OiBbXSwgbGlzdDogW10gfSxcbiAgICApXG5cbiAgICBpZiAocmVzdWx0Lmxpc3QubGVuZ3RoID4gMCkge1xuICAgICAgcmVzdWx0Lmxpc3RPZkxpc3QucHVzaChyZXN1bHQubGlzdClcbiAgICB9XG5cbiAgICBjb25zdCBlbmNvZGVyID0gbmV3IFRleHRFbmNvZGVyKClcbiAgICBjb25zdCBiYXRjaFJlc3VsdHMgPSBbXVxuXG4gICAgYXN5bmMuZWFjaFNlcmllcyhcbiAgICAgIHJlc3VsdC5saXN0T2ZMaXN0LFxuICAgICAgKGxpc3QsIGJhdGNoQ2IpID0+IHtcbiAgICAgICAgdmFyIG9iamVjdHMgPSBbXVxuICAgICAgICBsaXN0LmZvckVhY2goZnVuY3Rpb24gKHZhbHVlKSB7XG4gICAgICAgICAgaWYgKGlzT2JqZWN0KHZhbHVlKSkge1xuICAgICAgICAgICAgb2JqZWN0cy5wdXNoKHsgS2V5OiB2YWx1ZS5uYW1lLCBWZXJzaW9uSWQ6IHZhbHVlLnZlcnNpb25JZCB9KVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBvYmplY3RzLnB1c2goeyBLZXk6IHZhbHVlIH0pXG4gICAgICAgICAgfVxuICAgICAgICB9KVxuICAgICAgICBsZXQgZGVsZXRlT2JqZWN0cyA9IHsgRGVsZXRlOiB7IFF1aWV0OiB0cnVlLCBPYmplY3Q6IG9iamVjdHMgfSB9XG4gICAgICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoeyBoZWFkbGVzczogdHJ1ZSB9KVxuICAgICAgICBsZXQgcGF5bG9hZCA9IGJ1aWxkZXIuYnVpbGRPYmplY3QoZGVsZXRlT2JqZWN0cylcbiAgICAgICAgcGF5bG9hZCA9IEJ1ZmZlci5mcm9tKGVuY29kZXIuZW5jb2RlKHBheWxvYWQpKVxuICAgICAgICBjb25zdCBoZWFkZXJzID0ge31cblxuICAgICAgICBoZWFkZXJzWydDb250ZW50LU1ENSddID0gdG9NZDUocGF5bG9hZClcblxuICAgICAgICBsZXQgcmVtb3ZlT2JqZWN0c1Jlc3VsdFxuICAgICAgICB0aGlzLm1ha2VSZXF1ZXN0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSwgaGVhZGVycyB9LCBwYXlsb2FkLCBbMjAwXSwgJycsIHRydWUsIChlLCByZXNwb25zZSkgPT4ge1xuICAgICAgICAgIGlmIChlKSB7XG4gICAgICAgICAgICByZXR1cm4gYmF0Y2hDYihlKVxuICAgICAgICAgIH1cbiAgICAgICAgICBwaXBlc2V0dXAocmVzcG9uc2UsIHRyYW5zZm9ybWVycy5yZW1vdmVPYmplY3RzVHJhbnNmb3JtZXIoKSlcbiAgICAgICAgICAgIC5vbignZGF0YScsIChkYXRhKSA9PiB7XG4gICAgICAgICAgICAgIHJlbW92ZU9iamVjdHNSZXN1bHQgPSBkYXRhXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgLm9uKCdlcnJvcicsIChlKSA9PiB7XG4gICAgICAgICAgICAgIHJldHVybiBiYXRjaENiKGUsIG51bGwpXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgLm9uKCdlbmQnLCAoKSA9PiB7XG4gICAgICAgICAgICAgIGJhdGNoUmVzdWx0cy5wdXNoKHJlbW92ZU9iamVjdHNSZXN1bHQpXG4gICAgICAgICAgICAgIHJldHVybiBiYXRjaENiKG51bGwsIHJlbW92ZU9iamVjdHNSZXN1bHQpXG4gICAgICAgICAgICB9KVxuICAgICAgICB9KVxuICAgICAgfSxcbiAgICAgICgpID0+IHtcbiAgICAgICAgY2IobnVsbCwgXy5mbGF0dGVuKGJhdGNoUmVzdWx0cykpXG4gICAgICB9LFxuICAgIClcbiAgfVxuXG4gIC8vIEdlbmVyYXRlIGEgZ2VuZXJpYyBwcmVzaWduZWQgVVJMIHdoaWNoIGNhbiBiZVxuICAvLyB1c2VkIGZvciBIVFRQIG1ldGhvZHMgR0VULCBQVVQsIEhFQUQgYW5kIERFTEVURVxuICAvL1xuICAvLyBfX0FyZ3VtZW50c19fXG4gIC8vICogYG1ldGhvZGAgX3N0cmluZ186IG5hbWUgb2YgdGhlIEhUVFAgbWV0aG9kXG4gIC8vICogYGJ1Y2tldE5hbWVgIF9zdHJpbmdfOiBuYW1lIG9mIHRoZSBidWNrZXRcbiAgLy8gKiBgb2JqZWN0TmFtZWAgX3N0cmluZ186IG5hbWUgb2YgdGhlIG9iamVjdFxuICAvLyAqIGBleHBpcnlgIF9udW1iZXJfOiBleHBpcnkgaW4gc2Vjb25kcyAob3B0aW9uYWwsIGRlZmF1bHQgNyBkYXlzKVxuICAvLyAqIGByZXFQYXJhbXNgIF9vYmplY3RfOiByZXF1ZXN0IHBhcmFtZXRlcnMgKG9wdGlvbmFsKSBlLmcge3ZlcnNpb25JZDpcIjEwZmE5OTQ2LTNmNjQtNDEzNy1hNThmLTg4ODA2NWMwNzMyZVwifVxuICAvLyAqIGByZXF1ZXN0RGF0ZWAgX0RhdGVfOiBBIGRhdGUgb2JqZWN0LCB0aGUgdXJsIHdpbGwgYmUgaXNzdWVkIGF0IChvcHRpb25hbClcbiAgcHJlc2lnbmVkVXJsKG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgZXhwaXJlcywgcmVxUGFyYW1zLCByZXF1ZXN0RGF0ZSwgY2IpIHtcbiAgICBpZiAodGhpcy5hbm9ueW1vdXMpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuQW5vbnltb3VzUmVxdWVzdEVycm9yKCdQcmVzaWduZWQgJyArIG1ldGhvZCArICcgdXJsIGNhbm5vdCBiZSBnZW5lcmF0ZWQgZm9yIGFub255bW91cyByZXF1ZXN0cycpXG4gICAgfVxuICAgIGlmIChpc0Z1bmN0aW9uKHJlcXVlc3REYXRlKSkge1xuICAgICAgY2IgPSByZXF1ZXN0RGF0ZVxuICAgICAgcmVxdWVzdERhdGUgPSBuZXcgRGF0ZSgpXG4gICAgfVxuICAgIGlmIChpc0Z1bmN0aW9uKHJlcVBhcmFtcykpIHtcbiAgICAgIGNiID0gcmVxUGFyYW1zXG4gICAgICByZXFQYXJhbXMgPSB7fVxuICAgICAgcmVxdWVzdERhdGUgPSBuZXcgRGF0ZSgpXG4gICAgfVxuICAgIGlmIChpc0Z1bmN0aW9uKGV4cGlyZXMpKSB7XG4gICAgICBjYiA9IGV4cGlyZXNcbiAgICAgIHJlcVBhcmFtcyA9IHt9XG4gICAgICBleHBpcmVzID0gMjQgKiA2MCAqIDYwICogNyAvLyA3IGRheXMgaW4gc2Vjb25kc1xuICAgICAgcmVxdWVzdERhdGUgPSBuZXcgRGF0ZSgpXG4gICAgfVxuICAgIGlmICghaXNOdW1iZXIoZXhwaXJlcykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2V4cGlyZXMgc2hvdWxkIGJlIG9mIHR5cGUgXCJudW1iZXJcIicpXG4gICAgfVxuICAgIGlmICghaXNPYmplY3QocmVxUGFyYW1zKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVxUGFyYW1zIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWREYXRlKHJlcXVlc3REYXRlKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVxdWVzdERhdGUgc2hvdWxkIGJlIG9mIHR5cGUgXCJEYXRlXCIgYW5kIHZhbGlkJylcbiAgICB9XG4gICAgaWYgKCFpc0Z1bmN0aW9uKGNiKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignY2FsbGJhY2sgc2hvdWxkIGJlIG9mIHR5cGUgXCJmdW5jdGlvblwiJylcbiAgICB9XG4gICAgdmFyIHF1ZXJ5ID0gcXVlcnlzdHJpbmcuc3RyaW5naWZ5KHJlcVBhcmFtcylcbiAgICB0aGlzLmdldEJ1Y2tldFJlZ2lvbihidWNrZXROYW1lLCAoZSwgcmVnaW9uKSA9PiB7XG4gICAgICBpZiAoZSkge1xuICAgICAgICByZXR1cm4gY2IoZSlcbiAgICAgIH1cbiAgICAgIC8vIFRoaXMgc3RhdGVtZW50IGlzIGFkZGVkIHRvIGVuc3VyZSB0aGF0IHdlIHNlbmQgZXJyb3IgdGhyb3VnaFxuICAgICAgLy8gY2FsbGJhY2sgb24gcHJlc2lnbiBmYWlsdXJlLlxuICAgICAgdmFyIHVybFxuICAgICAgdmFyIHJlcU9wdGlvbnMgPSB0aGlzLmdldFJlcXVlc3RPcHRpb25zKHsgbWV0aG9kLCByZWdpb24sIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHF1ZXJ5IH0pXG5cbiAgICAgIHRoaXMuY2hlY2tBbmRSZWZyZXNoQ3JlZHMoKVxuICAgICAgdHJ5IHtcbiAgICAgICAgdXJsID0gcHJlc2lnblNpZ25hdHVyZVY0KFxuICAgICAgICAgIHJlcU9wdGlvbnMsXG4gICAgICAgICAgdGhpcy5hY2Nlc3NLZXksXG4gICAgICAgICAgdGhpcy5zZWNyZXRLZXksXG4gICAgICAgICAgdGhpcy5zZXNzaW9uVG9rZW4sXG4gICAgICAgICAgcmVnaW9uLFxuICAgICAgICAgIHJlcXVlc3REYXRlLFxuICAgICAgICAgIGV4cGlyZXMsXG4gICAgICAgIClcbiAgICAgIH0gY2F0Y2ggKHBlKSB7XG4gICAgICAgIHJldHVybiBjYihwZSlcbiAgICAgIH1cbiAgICAgIGNiKG51bGwsIHVybClcbiAgICB9KVxuICB9XG5cbiAgLy8gR2VuZXJhdGUgYSBwcmVzaWduZWQgVVJMIGZvciBHRVRcbiAgLy9cbiAgLy8gX19Bcmd1bWVudHNfX1xuICAvLyAqIGBidWNrZXROYW1lYCBfc3RyaW5nXzogbmFtZSBvZiB0aGUgYnVja2V0XG4gIC8vICogYG9iamVjdE5hbWVgIF9zdHJpbmdfOiBuYW1lIG9mIHRoZSBvYmplY3RcbiAgLy8gKiBgZXhwaXJ5YCBfbnVtYmVyXzogZXhwaXJ5IGluIHNlY29uZHMgKG9wdGlvbmFsLCBkZWZhdWx0IDcgZGF5cylcbiAgLy8gKiBgcmVzcEhlYWRlcnNgIF9vYmplY3RfOiByZXNwb25zZSBoZWFkZXJzIHRvIG92ZXJyaWRlIG9yIHJlcXVlc3QgcGFyYW1zIGZvciBxdWVyeSAob3B0aW9uYWwpIGUuZyB7dmVyc2lvbklkOlwiMTBmYTk5NDYtM2Y2NC00MTM3LWE1OGYtODg4MDY1YzA3MzJlXCJ9XG4gIC8vICogYHJlcXVlc3REYXRlYCBfRGF0ZV86IEEgZGF0ZSBvYmplY3QsIHRoZSB1cmwgd2lsbCBiZSBpc3N1ZWQgYXQgKG9wdGlvbmFsKVxuICBwcmVzaWduZWRHZXRPYmplY3QoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgZXhwaXJlcywgcmVzcEhlYWRlcnMsIHJlcXVlc3REYXRlLCBjYikge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuXG4gICAgaWYgKGlzRnVuY3Rpb24ocmVzcEhlYWRlcnMpKSB7XG4gICAgICBjYiA9IHJlc3BIZWFkZXJzXG4gICAgICByZXNwSGVhZGVycyA9IHt9XG4gICAgICByZXF1ZXN0RGF0ZSA9IG5ldyBEYXRlKClcbiAgICB9XG5cbiAgICB2YXIgdmFsaWRSZXNwSGVhZGVycyA9IFtcbiAgICAgICdyZXNwb25zZS1jb250ZW50LXR5cGUnLFxuICAgICAgJ3Jlc3BvbnNlLWNvbnRlbnQtbGFuZ3VhZ2UnLFxuICAgICAgJ3Jlc3BvbnNlLWV4cGlyZXMnLFxuICAgICAgJ3Jlc3BvbnNlLWNhY2hlLWNvbnRyb2wnLFxuICAgICAgJ3Jlc3BvbnNlLWNvbnRlbnQtZGlzcG9zaXRpb24nLFxuICAgICAgJ3Jlc3BvbnNlLWNvbnRlbnQtZW5jb2RpbmcnLFxuICAgIF1cbiAgICB2YWxpZFJlc3BIZWFkZXJzLmZvckVhY2goKGhlYWRlcikgPT4ge1xuICAgICAgaWYgKHJlc3BIZWFkZXJzICE9PSB1bmRlZmluZWQgJiYgcmVzcEhlYWRlcnNbaGVhZGVyXSAhPT0gdW5kZWZpbmVkICYmICFpc1N0cmluZyhyZXNwSGVhZGVyc1toZWFkZXJdKSkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGByZXNwb25zZSBoZWFkZXIgJHtoZWFkZXJ9IHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCJgKVxuICAgICAgfVxuICAgIH0pXG4gICAgcmV0dXJuIHRoaXMucHJlc2lnbmVkVXJsKCdHRVQnLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBleHBpcmVzLCByZXNwSGVhZGVycywgcmVxdWVzdERhdGUsIGNiKVxuICB9XG5cbiAgLy8gR2VuZXJhdGUgYSBwcmVzaWduZWQgVVJMIGZvciBQVVQuIFVzaW5nIHRoaXMgVVJMLCB0aGUgYnJvd3NlciBjYW4gdXBsb2FkIHRvIFMzIG9ubHkgd2l0aCB0aGUgc3BlY2lmaWVkIG9iamVjdCBuYW1lLlxuICAvL1xuICAvLyBfX0FyZ3VtZW50c19fXG4gIC8vICogYGJ1Y2tldE5hbWVgIF9zdHJpbmdfOiBuYW1lIG9mIHRoZSBidWNrZXRcbiAgLy8gKiBgb2JqZWN0TmFtZWAgX3N0cmluZ186IG5hbWUgb2YgdGhlIG9iamVjdFxuICAvLyAqIGBleHBpcnlgIF9udW1iZXJfOiBleHBpcnkgaW4gc2Vjb25kcyAob3B0aW9uYWwsIGRlZmF1bHQgNyBkYXlzKVxuICBwcmVzaWduZWRQdXRPYmplY3QoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgZXhwaXJlcywgY2IpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoYEludmFsaWQgYnVja2V0IG5hbWU6ICR7YnVja2V0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICByZXR1cm4gdGhpcy5wcmVzaWduZWRVcmwoJ1BVVCcsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGV4cGlyZXMsIGNiKVxuICB9XG5cbiAgLy8gcmV0dXJuIFBvc3RQb2xpY3kgb2JqZWN0XG4gIG5ld1Bvc3RQb2xpY3koKSB7XG4gICAgcmV0dXJuIG5ldyBQb3N0UG9saWN5KClcbiAgfVxuXG4gIC8vIHByZXNpZ25lZFBvc3RQb2xpY3kgY2FuIGJlIHVzZWQgaW4gc2l0dWF0aW9ucyB3aGVyZSB3ZSB3YW50IG1vcmUgY29udHJvbCBvbiB0aGUgdXBsb2FkIHRoYW4gd2hhdFxuICAvLyBwcmVzaWduZWRQdXRPYmplY3QoKSBwcm92aWRlcy4gaS5lIFVzaW5nIHByZXNpZ25lZFBvc3RQb2xpY3kgd2Ugd2lsbCBiZSBhYmxlIHRvIHB1dCBwb2xpY3kgcmVzdHJpY3Rpb25zXG4gIC8vIG9uIHRoZSBvYmplY3QncyBgbmFtZWAgYGJ1Y2tldGAgYGV4cGlyeWAgYENvbnRlbnQtVHlwZWAgYENvbnRlbnQtRGlzcG9zaXRpb25gIGBtZXRhRGF0YWBcbiAgcHJlc2lnbmVkUG9zdFBvbGljeShwb3N0UG9saWN5LCBjYikge1xuICAgIGlmICh0aGlzLmFub255bW91cykge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5Bbm9ueW1vdXNSZXF1ZXN0RXJyb3IoJ1ByZXNpZ25lZCBQT1NUIHBvbGljeSBjYW5ub3QgYmUgZ2VuZXJhdGVkIGZvciBhbm9ueW1vdXMgcmVxdWVzdHMnKVxuICAgIH1cbiAgICBpZiAoIWlzT2JqZWN0KHBvc3RQb2xpY3kpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdwb3N0UG9saWN5IHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cbiAgICBpZiAoIWlzRnVuY3Rpb24oY2IpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdjYiBzaG91bGQgYmUgb2YgdHlwZSBcImZ1bmN0aW9uXCInKVxuICAgIH1cbiAgICB0aGlzLmdldEJ1Y2tldFJlZ2lvbihwb3N0UG9saWN5LmZvcm1EYXRhLmJ1Y2tldCwgKGUsIHJlZ2lvbikgPT4ge1xuICAgICAgaWYgKGUpIHtcbiAgICAgICAgcmV0dXJuIGNiKGUpXG4gICAgICB9XG4gICAgICB2YXIgZGF0ZSA9IG5ldyBEYXRlKClcbiAgICAgIHZhciBkYXRlU3RyID0gbWFrZURhdGVMb25nKGRhdGUpXG5cbiAgICAgIHRoaXMuY2hlY2tBbmRSZWZyZXNoQ3JlZHMoKVxuXG4gICAgICBpZiAoIXBvc3RQb2xpY3kucG9saWN5LmV4cGlyYXRpb24pIHtcbiAgICAgICAgLy8gJ2V4cGlyYXRpb24nIGlzIG1hbmRhdG9yeSBmaWVsZCBmb3IgUzMuXG4gICAgICAgIC8vIFNldCBkZWZhdWx0IGV4cGlyYXRpb24gZGF0ZSBvZiA3IGRheXMuXG4gICAgICAgIHZhciBleHBpcmVzID0gbmV3IERhdGUoKVxuICAgICAgICBleHBpcmVzLnNldFNlY29uZHMoMjQgKiA2MCAqIDYwICogNylcbiAgICAgICAgcG9zdFBvbGljeS5zZXRFeHBpcmVzKGV4cGlyZXMpXG4gICAgICB9XG5cbiAgICAgIHBvc3RQb2xpY3kucG9saWN5LmNvbmRpdGlvbnMucHVzaChbJ2VxJywgJyR4LWFtei1kYXRlJywgZGF0ZVN0cl0pXG4gICAgICBwb3N0UG9saWN5LmZvcm1EYXRhWyd4LWFtei1kYXRlJ10gPSBkYXRlU3RyXG5cbiAgICAgIHBvc3RQb2xpY3kucG9saWN5LmNvbmRpdGlvbnMucHVzaChbJ2VxJywgJyR4LWFtei1hbGdvcml0aG0nLCAnQVdTNC1ITUFDLVNIQTI1NiddKVxuICAgICAgcG9zdFBvbGljeS5mb3JtRGF0YVsneC1hbXotYWxnb3JpdGhtJ10gPSAnQVdTNC1ITUFDLVNIQTI1NidcblxuICAgICAgcG9zdFBvbGljeS5wb2xpY3kuY29uZGl0aW9ucy5wdXNoKFsnZXEnLCAnJHgtYW16LWNyZWRlbnRpYWwnLCB0aGlzLmFjY2Vzc0tleSArICcvJyArIGdldFNjb3BlKHJlZ2lvbiwgZGF0ZSldKVxuICAgICAgcG9zdFBvbGljeS5mb3JtRGF0YVsneC1hbXotY3JlZGVudGlhbCddID0gdGhpcy5hY2Nlc3NLZXkgKyAnLycgKyBnZXRTY29wZShyZWdpb24sIGRhdGUpXG5cbiAgICAgIGlmICh0aGlzLnNlc3Npb25Ub2tlbikge1xuICAgICAgICBwb3N0UG9saWN5LnBvbGljeS5jb25kaXRpb25zLnB1c2goWydlcScsICckeC1hbXotc2VjdXJpdHktdG9rZW4nLCB0aGlzLnNlc3Npb25Ub2tlbl0pXG4gICAgICAgIHBvc3RQb2xpY3kuZm9ybURhdGFbJ3gtYW16LXNlY3VyaXR5LXRva2VuJ10gPSB0aGlzLnNlc3Npb25Ub2tlblxuICAgICAgfVxuXG4gICAgICB2YXIgcG9saWN5QmFzZTY0ID0gQnVmZmVyLmZyb20oSlNPTi5zdHJpbmdpZnkocG9zdFBvbGljeS5wb2xpY3kpKS50b1N0cmluZygnYmFzZTY0JylcblxuICAgICAgcG9zdFBvbGljeS5mb3JtRGF0YS5wb2xpY3kgPSBwb2xpY3lCYXNlNjRcblxuICAgICAgdmFyIHNpZ25hdHVyZSA9IHBvc3RQcmVzaWduU2lnbmF0dXJlVjQocmVnaW9uLCBkYXRlLCB0aGlzLnNlY3JldEtleSwgcG9saWN5QmFzZTY0KVxuXG4gICAgICBwb3N0UG9saWN5LmZvcm1EYXRhWyd4LWFtei1zaWduYXR1cmUnXSA9IHNpZ25hdHVyZVxuICAgICAgdmFyIG9wdHMgPSB7fVxuICAgICAgb3B0cy5yZWdpb24gPSByZWdpb25cbiAgICAgIG9wdHMuYnVja2V0TmFtZSA9IHBvc3RQb2xpY3kuZm9ybURhdGEuYnVja2V0XG4gICAgICB2YXIgcmVxT3B0aW9ucyA9IHRoaXMuZ2V0UmVxdWVzdE9wdGlvbnMob3B0cylcbiAgICAgIHZhciBwb3J0U3RyID0gdGhpcy5wb3J0ID09IDgwIHx8IHRoaXMucG9ydCA9PT0gNDQzID8gJycgOiBgOiR7dGhpcy5wb3J0LnRvU3RyaW5nKCl9YFxuICAgICAgdmFyIHVybFN0ciA9IGAke3JlcU9wdGlvbnMucHJvdG9jb2x9Ly8ke3JlcU9wdGlvbnMuaG9zdH0ke3BvcnRTdHJ9JHtyZXFPcHRpb25zLnBhdGh9YFxuICAgICAgY2IobnVsbCwgeyBwb3N0VVJMOiB1cmxTdHIsIGZvcm1EYXRhOiBwb3N0UG9saWN5LmZvcm1EYXRhIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8vIFJlbW92ZSBhbGwgdGhlIG5vdGlmaWNhdGlvbiBjb25maWd1cmF0aW9ucyBpbiB0aGUgUzMgcHJvdmlkZXJcbiAgc2V0QnVja2V0Tm90aWZpY2F0aW9uKGJ1Y2tldE5hbWUsIGNvbmZpZywgY2IpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzT2JqZWN0KGNvbmZpZykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ25vdGlmaWNhdGlvbiBjb25maWcgc2hvdWxkIGJlIG9mIHR5cGUgXCJPYmplY3RcIicpXG4gICAgfVxuICAgIGlmICghaXNGdW5jdGlvbihjYikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2NhbGxiYWNrIHNob3VsZCBiZSBvZiB0eXBlIFwiZnVuY3Rpb25cIicpXG4gICAgfVxuICAgIHZhciBtZXRob2QgPSAnUFVUJ1xuICAgIHZhciBxdWVyeSA9ICdub3RpZmljYXRpb24nXG4gICAgdmFyIGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoe1xuICAgICAgcm9vdE5hbWU6ICdOb3RpZmljYXRpb25Db25maWd1cmF0aW9uJyxcbiAgICAgIHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9LFxuICAgICAgaGVhZGxlc3M6IHRydWUsXG4gICAgfSlcbiAgICB2YXIgcGF5bG9hZCA9IGJ1aWxkZXIuYnVpbGRPYmplY3QoY29uZmlnKVxuICAgIHRoaXMubWFrZVJlcXVlc3QoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0sIHBheWxvYWQsIFsyMDBdLCAnJywgZmFsc2UsIGNiKVxuICB9XG5cbiAgcmVtb3ZlQWxsQnVja2V0Tm90aWZpY2F0aW9uKGJ1Y2tldE5hbWUsIGNiKSB7XG4gICAgdGhpcy5zZXRCdWNrZXROb3RpZmljYXRpb24oYnVja2V0TmFtZSwgbmV3IE5vdGlmaWNhdGlvbkNvbmZpZygpLCBjYilcbiAgfVxuXG4gIC8vIFJldHVybiB0aGUgbGlzdCBvZiBub3RpZmljYXRpb24gY29uZmlndXJhdGlvbnMgc3RvcmVkXG4gIC8vIGluIHRoZSBTMyBwcm92aWRlclxuICBnZXRCdWNrZXROb3RpZmljYXRpb24oYnVja2V0TmFtZSwgY2IpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzRnVuY3Rpb24oY2IpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdjYWxsYmFjayBzaG91bGQgYmUgb2YgdHlwZSBcImZ1bmN0aW9uXCInKVxuICAgIH1cbiAgICB2YXIgbWV0aG9kID0gJ0dFVCdcbiAgICB2YXIgcXVlcnkgPSAnbm90aWZpY2F0aW9uJ1xuICAgIHRoaXMubWFrZVJlcXVlc3QoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0sICcnLCBbMjAwXSwgJycsIHRydWUsIChlLCByZXNwb25zZSkgPT4ge1xuICAgICAgaWYgKGUpIHtcbiAgICAgICAgcmV0dXJuIGNiKGUpXG4gICAgICB9XG4gICAgICB2YXIgdHJhbnNmb3JtZXIgPSB0cmFuc2Zvcm1lcnMuZ2V0QnVja2V0Tm90aWZpY2F0aW9uVHJhbnNmb3JtZXIoKVxuICAgICAgdmFyIGJ1Y2tldE5vdGlmaWNhdGlvblxuICAgICAgcGlwZXNldHVwKHJlc3BvbnNlLCB0cmFuc2Zvcm1lcilcbiAgICAgICAgLm9uKCdkYXRhJywgKHJlc3VsdCkgPT4gKGJ1Y2tldE5vdGlmaWNhdGlvbiA9IHJlc3VsdCkpXG4gICAgICAgIC5vbignZXJyb3InLCAoZSkgPT4gY2IoZSkpXG4gICAgICAgIC5vbignZW5kJywgKCkgPT4gY2IobnVsbCwgYnVja2V0Tm90aWZpY2F0aW9uKSlcbiAgICB9KVxuICB9XG5cbiAgLy8gTGlzdGVucyBmb3IgYnVja2V0IG5vdGlmaWNhdGlvbnMuIFJldHVybnMgYW4gRXZlbnRFbWl0dGVyLlxuICBsaXN0ZW5CdWNrZXROb3RpZmljYXRpb24oYnVja2V0TmFtZSwgcHJlZml4LCBzdWZmaXgsIGV2ZW50cykge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcihgSW52YWxpZCBidWNrZXQgbmFtZTogJHtidWNrZXROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcocHJlZml4KSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncHJlZml4IG11c3QgYmUgb2YgdHlwZSBzdHJpbmcnKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHN1ZmZpeCkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3N1ZmZpeCBtdXN0IGJlIG9mIHR5cGUgc3RyaW5nJylcbiAgICB9XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KGV2ZW50cykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2V2ZW50cyBtdXN0IGJlIG9mIHR5cGUgQXJyYXknKVxuICAgIH1cbiAgICBsZXQgbGlzdGVuZXIgPSBuZXcgTm90aWZpY2F0aW9uUG9sbGVyKHRoaXMsIGJ1Y2tldE5hbWUsIHByZWZpeCwgc3VmZml4LCBldmVudHMpXG4gICAgbGlzdGVuZXIuc3RhcnQoKVxuXG4gICAgcmV0dXJuIGxpc3RlbmVyXG4gIH1cblxuICAvKiogVG8gc2V0IFRhZ3Mgb24gYSBidWNrZXQgb3Igb2JqZWN0IGJhc2VkIG9uIHRoZSBwYXJhbXNcbiAgICogIF9fQXJndW1lbnRzX19cbiAgICogdGFnZ2luZ1BhcmFtcyBfb2JqZWN0XyBXaGljaCBjb250YWlucyB0aGUgZm9sbG93aW5nIHByb3BlcnRpZXNcbiAgICogIGJ1Y2tldE5hbWUgX3N0cmluZ18sXG4gICAqICBvYmplY3ROYW1lIF9zdHJpbmdfIChPcHRpb25hbCksXG4gICAqICB0YWdzIF9vYmplY3RfIG9mIHRoZSBmb3JtIHsnPHRhZy1rZXktMT4nOic8dGFnLXZhbHVlLTE+JywnPHRhZy1rZXktMj4nOic8dGFnLXZhbHVlLTI+J31cbiAgICogIHB1dE9wdHMgX29iamVjdF8gKE9wdGlvbmFsKSBlLmcge3ZlcnNpb25JZDpcIm15LW9iamVjdC12ZXJzaW9uLWlkXCJ9LFxuICAgKiAgY2IoZXJyb3IpYCBfZnVuY3Rpb25fIC0gY2FsbGJhY2sgZnVuY3Rpb24gd2l0aCBgZXJyYCBhcyB0aGUgZXJyb3IgYXJndW1lbnQuIGBlcnJgIGlzIG51bGwgaWYgdGhlIG9wZXJhdGlvbiBpcyBzdWNjZXNzZnVsLlxuICAgKi9cbiAgc2V0VGFnZ2luZyh0YWdnaW5nUGFyYW1zKSB7XG4gICAgY29uc3QgeyBidWNrZXROYW1lLCBvYmplY3ROYW1lLCB0YWdzLCBwdXRPcHRzID0ge30sIGNiIH0gPSB0YWdnaW5nUGFyYW1zXG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcbiAgICBsZXQgcXVlcnkgPSAndGFnZ2luZydcblxuICAgIGlmIChwdXRPcHRzICYmIHB1dE9wdHMudmVyc2lvbklkKSB7XG4gICAgICBxdWVyeSA9IGAke3F1ZXJ5fSZ2ZXJzaW9uSWQ9JHtwdXRPcHRzLnZlcnNpb25JZH1gXG4gICAgfVxuICAgIGNvbnN0IHRhZ3NMaXN0ID0gW11cbiAgICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyh0YWdzKSkge1xuICAgICAgdGFnc0xpc3QucHVzaCh7IEtleToga2V5LCBWYWx1ZTogdmFsdWUgfSlcbiAgICB9XG4gICAgY29uc3QgdGFnZ2luZ0NvbmZpZyA9IHtcbiAgICAgIFRhZ2dpbmc6IHtcbiAgICAgICAgVGFnU2V0OiB7XG4gICAgICAgICAgVGFnOiB0YWdzTGlzdCxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfVxuICAgIGNvbnN0IGVuY29kZXIgPSBuZXcgVGV4dEVuY29kZXIoKVxuICAgIGNvbnN0IGhlYWRlcnMgPSB7fVxuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoeyBoZWFkbGVzczogdHJ1ZSwgcmVuZGVyT3B0czogeyBwcmV0dHk6IGZhbHNlIH0gfSlcbiAgICBsZXQgcGF5bG9hZCA9IGJ1aWxkZXIuYnVpbGRPYmplY3QodGFnZ2luZ0NvbmZpZylcbiAgICBwYXlsb2FkID0gQnVmZmVyLmZyb20oZW5jb2Rlci5lbmNvZGUocGF5bG9hZCkpXG4gICAgaGVhZGVyc1snQ29udGVudC1NRDUnXSA9IHRvTWQ1KHBheWxvYWQpXG4gICAgY29uc3QgcmVxdWVzdE9wdGlvbnMgPSB7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnksIGhlYWRlcnMgfVxuXG4gICAgaWYgKG9iamVjdE5hbWUpIHtcbiAgICAgIHJlcXVlc3RPcHRpb25zWydvYmplY3ROYW1lJ10gPSBvYmplY3ROYW1lXG4gICAgfVxuICAgIGhlYWRlcnNbJ0NvbnRlbnQtTUQ1J10gPSB0b01kNShwYXlsb2FkKVxuXG4gICAgdGhpcy5tYWtlUmVxdWVzdChyZXF1ZXN0T3B0aW9ucywgcGF5bG9hZCwgWzIwMF0sICcnLCBmYWxzZSwgY2IpXG4gIH1cblxuICAvKiogU2V0IFRhZ3Mgb24gYSBCdWNrZXRcbiAgICogX19Bcmd1bWVudHNfX1xuICAgKiBidWNrZXROYW1lIF9zdHJpbmdfXG4gICAqIHRhZ3MgX29iamVjdF8gb2YgdGhlIGZvcm0geyc8dGFnLWtleS0xPic6Jzx0YWctdmFsdWUtMT4nLCc8dGFnLWtleS0yPic6Jzx0YWctdmFsdWUtMj4nfVxuICAgKiBgY2IoZXJyb3IpYCBfZnVuY3Rpb25fIC0gY2FsbGJhY2sgZnVuY3Rpb24gd2l0aCBgZXJyYCBhcyB0aGUgZXJyb3IgYXJndW1lbnQuIGBlcnJgIGlzIG51bGwgaWYgdGhlIG9wZXJhdGlvbiBpcyBzdWNjZXNzZnVsLlxuICAgKi9cbiAgc2V0QnVja2V0VGFnZ2luZyhidWNrZXROYW1lLCB0YWdzLCBjYikge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNPYmplY3QodGFncykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3RhZ3Mgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuICAgIGlmIChPYmplY3Qua2V5cyh0YWdzKS5sZW5ndGggPiAxMCkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignbWF4aW11bSB0YWdzIGFsbG93ZWQgaXMgMTBcIicpXG4gICAgfVxuICAgIGlmICghaXNGdW5jdGlvbihjYikpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ2NhbGxiYWNrIHNob3VsZCBiZSBvZiB0eXBlIFwiZnVuY3Rpb25cIicpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuc2V0VGFnZ2luZyh7IGJ1Y2tldE5hbWUsIHRhZ3MsIGNiIH0pXG4gIH1cblxuICAvKiogU2V0IFRhZ3Mgb24gYW4gT2JqZWN0XG4gICAqIF9fQXJndW1lbnRzX19cbiAgICogYnVja2V0TmFtZSBfc3RyaW5nX1xuICAgKiBvYmplY3ROYW1lIF9zdHJpbmdfXG4gICAqICAqIHRhZ3MgX29iamVjdF8gb2YgdGhlIGZvcm0geyc8dGFnLWtleS0xPic6Jzx0YWctdmFsdWUtMT4nLCc8dGFnLWtleS0yPic6Jzx0YWctdmFsdWUtMj4nfVxuICAgKiAgcHV0T3B0cyBfb2JqZWN0XyAoT3B0aW9uYWwpIGUuZyB7dmVyc2lvbklkOlwibXktb2JqZWN0LXZlcnNpb24taWRcIn0sXG4gICAqIGBjYihlcnJvcilgIF9mdW5jdGlvbl8gLSBjYWxsYmFjayBmdW5jdGlvbiB3aXRoIGBlcnJgIGFzIHRoZSBlcnJvciBhcmd1bWVudC4gYGVycmAgaXMgbnVsbCBpZiB0aGUgb3BlcmF0aW9uIGlzIHN1Y2Nlc3NmdWwuXG4gICAqL1xuICBzZXRPYmplY3RUYWdnaW5nKGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHRhZ3MsIHB1dE9wdHMgPSB7fSwgY2IpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgb2JqZWN0IG5hbWU6ICcgKyBvYmplY3ROYW1lKVxuICAgIH1cblxuICAgIGlmIChpc0Z1bmN0aW9uKHB1dE9wdHMpKSB7XG4gICAgICBjYiA9IHB1dE9wdHNcbiAgICAgIHB1dE9wdHMgPSB7fVxuICAgIH1cblxuICAgIGlmICghaXNPYmplY3QodGFncykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3RhZ3Mgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuICAgIGlmIChPYmplY3Qua2V5cyh0YWdzKS5sZW5ndGggPiAxMCkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignTWF4aW11bSB0YWdzIGFsbG93ZWQgaXMgMTBcIicpXG4gICAgfVxuXG4gICAgaWYgKCFpc0Z1bmN0aW9uKGNiKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignY2FsbGJhY2sgc2hvdWxkIGJlIG9mIHR5cGUgXCJmdW5jdGlvblwiJylcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuc2V0VGFnZ2luZyh7IGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHRhZ3MsIHB1dE9wdHMsIGNiIH0pXG4gIH1cblxuICAvKiogUmVtb3ZlIFRhZ3Mgb24gYW4gQnVja2V0L09iamVjdCBiYXNlZCBvbiBwYXJhbXNcbiAgICogX19Bcmd1bWVudHNfX1xuICAgKiBidWNrZXROYW1lIF9zdHJpbmdfXG4gICAqIG9iamVjdE5hbWUgX3N0cmluZ18gKG9wdGlvbmFsKVxuICAgKiByZW1vdmVPcHRzIF9vYmplY3RfIChPcHRpb25hbCkgZS5nIHt2ZXJzaW9uSWQ6XCJteS1vYmplY3QtdmVyc2lvbi1pZFwifSxcbiAgICogYGNiKGVycm9yKWAgX2Z1bmN0aW9uXyAtIGNhbGxiYWNrIGZ1bmN0aW9uIHdpdGggYGVycmAgYXMgdGhlIGVycm9yIGFyZ3VtZW50LiBgZXJyYCBpcyBudWxsIGlmIHRoZSBvcGVyYXRpb24gaXMgc3VjY2Vzc2Z1bC5cbiAgICovXG4gIHJlbW92ZVRhZ2dpbmcoeyBidWNrZXROYW1lLCBvYmplY3ROYW1lLCByZW1vdmVPcHRzLCBjYiB9KSB7XG4gICAgY29uc3QgbWV0aG9kID0gJ0RFTEVURSdcbiAgICBsZXQgcXVlcnkgPSAndGFnZ2luZydcblxuICAgIGlmIChyZW1vdmVPcHRzICYmIE9iamVjdC5rZXlzKHJlbW92ZU9wdHMpLmxlbmd0aCAmJiByZW1vdmVPcHRzLnZlcnNpb25JZCkge1xuICAgICAgcXVlcnkgPSBgJHtxdWVyeX0mdmVyc2lvbklkPSR7cmVtb3ZlT3B0cy52ZXJzaW9uSWR9YFxuICAgIH1cbiAgICBjb25zdCByZXF1ZXN0T3B0aW9ucyA9IHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSB9XG5cbiAgICBpZiAob2JqZWN0TmFtZSkge1xuICAgICAgcmVxdWVzdE9wdGlvbnNbJ29iamVjdE5hbWUnXSA9IG9iamVjdE5hbWVcbiAgICB9XG4gICAgdGhpcy5tYWtlUmVxdWVzdChyZXF1ZXN0T3B0aW9ucywgJycsIFsyMDAsIDIwNF0sICcnLCB0cnVlLCBjYilcbiAgfVxuXG4gIC8qKiBSZW1vdmUgVGFncyBhc3NvY2lhdGVkIHdpdGggYSBidWNrZXRcbiAgICogIF9fQXJndW1lbnRzX19cbiAgICogYnVja2V0TmFtZSBfc3RyaW5nX1xuICAgKiBgY2IoZXJyb3IpYCBfZnVuY3Rpb25fIC0gY2FsbGJhY2sgZnVuY3Rpb24gd2l0aCBgZXJyYCBhcyB0aGUgZXJyb3IgYXJndW1lbnQuIGBlcnJgIGlzIG51bGwgaWYgdGhlIG9wZXJhdGlvbiBpcyBzdWNjZXNzZnVsLlxuICAgKi9cbiAgcmVtb3ZlQnVja2V0VGFnZ2luZyhidWNrZXROYW1lLCBjYikge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNGdW5jdGlvbihjYikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2NhbGxiYWNrIHNob3VsZCBiZSBvZiB0eXBlIFwiZnVuY3Rpb25cIicpXG4gICAgfVxuICAgIHJldHVybiB0aGlzLnJlbW92ZVRhZ2dpbmcoeyBidWNrZXROYW1lLCBjYiB9KVxuICB9XG5cbiAgLyoqIFJlbW92ZSB0YWdzIGFzc29jaWF0ZWQgd2l0aCBhbiBvYmplY3RcbiAgICogX19Bcmd1bWVudHNfX1xuICAgKiBidWNrZXROYW1lIF9zdHJpbmdfXG4gICAqIG9iamVjdE5hbWUgX3N0cmluZ19cbiAgICogcmVtb3ZlT3B0cyBfb2JqZWN0XyAoT3B0aW9uYWwpIGUuZy4ge1ZlcnNpb25JRDpcIm15LW9iamVjdC12ZXJzaW9uLWlkXCJ9XG4gICAqIGBjYihlcnJvcilgIF9mdW5jdGlvbl8gLSBjYWxsYmFjayBmdW5jdGlvbiB3aXRoIGBlcnJgIGFzIHRoZSBlcnJvciBhcmd1bWVudC4gYGVycmAgaXMgbnVsbCBpZiB0aGUgb3BlcmF0aW9uIGlzIHN1Y2Nlc3NmdWwuXG4gICAqL1xuICByZW1vdmVPYmplY3RUYWdnaW5nKGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHJlbW92ZU9wdHMsIGNiKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIG9iamVjdCBuYW1lOiAnICsgb2JqZWN0TmFtZSlcbiAgICB9XG4gICAgaWYgKGlzRnVuY3Rpb24ocmVtb3ZlT3B0cykpIHtcbiAgICAgIGNiID0gcmVtb3ZlT3B0c1xuICAgICAgcmVtb3ZlT3B0cyA9IHt9XG4gICAgfVxuICAgIGlmIChyZW1vdmVPcHRzICYmIE9iamVjdC5rZXlzKHJlbW92ZU9wdHMpLmxlbmd0aCAmJiAhaXNPYmplY3QocmVtb3ZlT3B0cykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3JlbW92ZU9wdHMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuXG4gICAgaWYgKCFpc0Z1bmN0aW9uKGNiKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignY2FsbGJhY2sgc2hvdWxkIGJlIG9mIHR5cGUgXCJmdW5jdGlvblwiJylcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5yZW1vdmVUYWdnaW5nKHsgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcmVtb3ZlT3B0cywgY2IgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBseSBsaWZlY3ljbGUgY29uZmlndXJhdGlvbiBvbiBhIGJ1Y2tldC5cbiAgICogYnVja2V0TmFtZSBfc3RyaW5nX1xuICAgKiBwb2xpY3lDb25maWcgX29iamVjdF8gYSB2YWxpZCBwb2xpY3kgY29uZmlndXJhdGlvbiBvYmplY3QuXG4gICAqIGBjYihlcnJvcilgIF9mdW5jdGlvbl8gLSBjYWxsYmFjayBmdW5jdGlvbiB3aXRoIGBlcnJgIGFzIHRoZSBlcnJvciBhcmd1bWVudC4gYGVycmAgaXMgbnVsbCBpZiB0aGUgb3BlcmF0aW9uIGlzIHN1Y2Nlc3NmdWwuXG4gICAqL1xuICBhcHBseUJ1Y2tldExpZmVjeWNsZShidWNrZXROYW1lLCBwb2xpY3lDb25maWcsIGNiKSB7XG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcbiAgICBjb25zdCBxdWVyeSA9ICdsaWZlY3ljbGUnXG5cbiAgICBjb25zdCBlbmNvZGVyID0gbmV3IFRleHRFbmNvZGVyKClcbiAgICBjb25zdCBoZWFkZXJzID0ge31cbiAgICBjb25zdCBidWlsZGVyID0gbmV3IHhtbDJqcy5CdWlsZGVyKHtcbiAgICAgIHJvb3ROYW1lOiAnTGlmZWN5Y2xlQ29uZmlndXJhdGlvbicsXG4gICAgICBoZWFkbGVzczogdHJ1ZSxcbiAgICAgIHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9LFxuICAgIH0pXG4gICAgbGV0IHBheWxvYWQgPSBidWlsZGVyLmJ1aWxkT2JqZWN0KHBvbGljeUNvbmZpZylcbiAgICBwYXlsb2FkID0gQnVmZmVyLmZyb20oZW5jb2Rlci5lbmNvZGUocGF5bG9hZCkpXG4gICAgY29uc3QgcmVxdWVzdE9wdGlvbnMgPSB7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnksIGhlYWRlcnMgfVxuICAgIGhlYWRlcnNbJ0NvbnRlbnQtTUQ1J10gPSB0b01kNShwYXlsb2FkKVxuXG4gICAgdGhpcy5tYWtlUmVxdWVzdChyZXF1ZXN0T3B0aW9ucywgcGF5bG9hZCwgWzIwMF0sICcnLCBmYWxzZSwgY2IpXG4gIH1cblxuICAvKiogUmVtb3ZlIGxpZmVjeWNsZSBjb25maWd1cmF0aW9uIG9mIGEgYnVja2V0LlxuICAgKiBidWNrZXROYW1lIF9zdHJpbmdfXG4gICAqIGBjYihlcnJvcilgIF9mdW5jdGlvbl8gLSBjYWxsYmFjayBmdW5jdGlvbiB3aXRoIGBlcnJgIGFzIHRoZSBlcnJvciBhcmd1bWVudC4gYGVycmAgaXMgbnVsbCBpZiB0aGUgb3BlcmF0aW9uIGlzIHN1Y2Nlc3NmdWwuXG4gICAqL1xuICByZW1vdmVCdWNrZXRMaWZlY3ljbGUoYnVja2V0TmFtZSwgY2IpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnREVMRVRFJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ2xpZmVjeWNsZSdcbiAgICB0aGlzLm1ha2VSZXF1ZXN0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9LCAnJywgWzIwNF0sICcnLCBmYWxzZSwgY2IpXG4gIH1cblxuICAvKiogU2V0L092ZXJyaWRlIGxpZmVjeWNsZSBjb25maWd1cmF0aW9uIG9uIGEgYnVja2V0LiBpZiB0aGUgY29uZmlndXJhdGlvbiBpcyBlbXB0eSwgaXQgcmVtb3ZlcyB0aGUgY29uZmlndXJhdGlvbi5cbiAgICogYnVja2V0TmFtZSBfc3RyaW5nX1xuICAgKiBsaWZlQ3ljbGVDb25maWcgX29iamVjdF8gb25lIG9mIHRoZSBmb2xsb3dpbmcgdmFsdWVzOiAobnVsbCBvciAnJykgdG8gcmVtb3ZlIHRoZSBsaWZlY3ljbGUgY29uZmlndXJhdGlvbi4gb3IgYSB2YWxpZCBsaWZlY3ljbGUgY29uZmlndXJhdGlvblxuICAgKiBgY2IoZXJyb3IpYCBfZnVuY3Rpb25fIC0gY2FsbGJhY2sgZnVuY3Rpb24gd2l0aCBgZXJyYCBhcyB0aGUgZXJyb3IgYXJndW1lbnQuIGBlcnJgIGlzIG51bGwgaWYgdGhlIG9wZXJhdGlvbiBpcyBzdWNjZXNzZnVsLlxuICAgKi9cbiAgc2V0QnVja2V0TGlmZWN5Y2xlKGJ1Y2tldE5hbWUsIGxpZmVDeWNsZUNvbmZpZyA9IG51bGwsIGNiKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKF8uaXNFbXB0eShsaWZlQ3ljbGVDb25maWcpKSB7XG4gICAgICB0aGlzLnJlbW92ZUJ1Y2tldExpZmVjeWNsZShidWNrZXROYW1lLCBjYilcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5hcHBseUJ1Y2tldExpZmVjeWNsZShidWNrZXROYW1lLCBsaWZlQ3ljbGVDb25maWcsIGNiKVxuICAgIH1cbiAgfVxuXG4gIC8qKiBHZXQgbGlmZWN5Y2xlIGNvbmZpZ3VyYXRpb24gb24gYSBidWNrZXQuXG4gICAqIGJ1Y2tldE5hbWUgX3N0cmluZ19cbiAgICogYGNiKGNvbmZpZylgIF9mdW5jdGlvbl8gLSBjYWxsYmFjayBmdW5jdGlvbiB3aXRoIGxpZmVjeWNsZSBjb25maWd1cmF0aW9uIGFzIHRoZSBlcnJvciBhcmd1bWVudC5cbiAgICovXG4gIGdldEJ1Y2tldExpZmVjeWNsZShidWNrZXROYW1lLCBjYikge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgY29uc3QgcXVlcnkgPSAnbGlmZWN5Y2xlJ1xuICAgIGNvbnN0IHJlcXVlc3RPcHRpb25zID0geyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH1cblxuICAgIHRoaXMubWFrZVJlcXVlc3QocmVxdWVzdE9wdGlvbnMsICcnLCBbMjAwXSwgJycsIHRydWUsIChlLCByZXNwb25zZSkgPT4ge1xuICAgICAgY29uc3QgdHJhbnNmb3JtZXIgPSB0cmFuc2Zvcm1lcnMubGlmZWN5Y2xlVHJhbnNmb3JtZXIoKVxuICAgICAgaWYgKGUpIHtcbiAgICAgICAgcmV0dXJuIGNiKGUpXG4gICAgICB9XG4gICAgICBsZXQgbGlmZWN5Y2xlQ29uZmlnXG4gICAgICBwaXBlc2V0dXAocmVzcG9uc2UsIHRyYW5zZm9ybWVyKVxuICAgICAgICAub24oJ2RhdGEnLCAocmVzdWx0KSA9PiAobGlmZWN5Y2xlQ29uZmlnID0gcmVzdWx0KSlcbiAgICAgICAgLm9uKCdlcnJvcicsIChlKSA9PiBjYihlKSlcbiAgICAgICAgLm9uKCdlbmQnLCAoKSA9PiBjYihudWxsLCBsaWZlY3ljbGVDb25maWcpKVxuICAgIH0pXG4gIH1cblxuICBnZXRPYmplY3RSZXRlbnRpb24oYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgZ2V0T3B0cywgY2IpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzT2JqZWN0KGdldE9wdHMpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdjYWxsYmFjayBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9IGVsc2UgaWYgKGdldE9wdHMudmVyc2lvbklkICYmICFpc1N0cmluZyhnZXRPcHRzLnZlcnNpb25JZCkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ1ZlcnNpb25JRCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKGNiICYmICFpc0Z1bmN0aW9uKGNiKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignY2FsbGJhY2sgc2hvdWxkIGJlIG9mIHR5cGUgXCJmdW5jdGlvblwiJylcbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcbiAgICBsZXQgcXVlcnkgPSAncmV0ZW50aW9uJ1xuICAgIGlmIChnZXRPcHRzLnZlcnNpb25JZCkge1xuICAgICAgcXVlcnkgKz0gYCZ2ZXJzaW9uSWQ9JHtnZXRPcHRzLnZlcnNpb25JZH1gXG4gICAgfVxuXG4gICAgdGhpcy5tYWtlUmVxdWVzdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnkgfSwgJycsIFsyMDBdLCAnJywgdHJ1ZSwgKGUsIHJlc3BvbnNlKSA9PiB7XG4gICAgICBpZiAoZSkge1xuICAgICAgICByZXR1cm4gY2IoZSlcbiAgICAgIH1cblxuICAgICAgbGV0IHJldGVudGlvbkNvbmZpZyA9IEJ1ZmZlci5mcm9tKCcnKVxuICAgICAgcGlwZXNldHVwKHJlc3BvbnNlLCB0cmFuc2Zvcm1lcnMub2JqZWN0UmV0ZW50aW9uVHJhbnNmb3JtZXIoKSlcbiAgICAgICAgLm9uKCdkYXRhJywgKGRhdGEpID0+IHtcbiAgICAgICAgICByZXRlbnRpb25Db25maWcgPSBkYXRhXG4gICAgICAgIH0pXG4gICAgICAgIC5vbignZXJyb3InLCBjYilcbiAgICAgICAgLm9uKCdlbmQnLCAoKSA9PiB7XG4gICAgICAgICAgY2IobnVsbCwgcmV0ZW50aW9uQ29uZmlnKVxuICAgICAgICB9KVxuICAgIH0pXG4gIH1cblxuICBzZXRCdWNrZXRFbmNyeXB0aW9uKGJ1Y2tldE5hbWUsIGVuY3J5cHRpb25Db25maWcsIGNiKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG5cbiAgICBpZiAoaXNGdW5jdGlvbihlbmNyeXB0aW9uQ29uZmlnKSkge1xuICAgICAgY2IgPSBlbmNyeXB0aW9uQ29uZmlnXG4gICAgICBlbmNyeXB0aW9uQ29uZmlnID0gbnVsbFxuICAgIH1cblxuICAgIGlmICghXy5pc0VtcHR5KGVuY3J5cHRpb25Db25maWcpICYmIGVuY3J5cHRpb25Db25maWcuUnVsZS5sZW5ndGggPiAxKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdJbnZhbGlkIFJ1bGUgbGVuZ3RoLiBPbmx5IG9uZSBydWxlIGlzIGFsbG93ZWQuOiAnICsgZW5jcnlwdGlvbkNvbmZpZy5SdWxlKVxuICAgIH1cbiAgICBpZiAoY2IgJiYgIWlzRnVuY3Rpb24oY2IpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdjYWxsYmFjayBzaG91bGQgYmUgb2YgdHlwZSBcImZ1bmN0aW9uXCInKVxuICAgIH1cblxuICAgIGxldCBlbmNyeXB0aW9uT2JqID0gZW5jcnlwdGlvbkNvbmZpZ1xuICAgIGlmIChfLmlzRW1wdHkoZW5jcnlwdGlvbkNvbmZpZykpIHtcbiAgICAgIGVuY3J5cHRpb25PYmogPSB7XG4gICAgICAgIC8vIERlZmF1bHQgTWluSU8gU2VydmVyIFN1cHBvcnRlZCBSdWxlXG4gICAgICAgIFJ1bGU6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBBcHBseVNlcnZlclNpZGVFbmNyeXB0aW9uQnlEZWZhdWx0OiB7XG4gICAgICAgICAgICAgIFNTRUFsZ29yaXRobTogJ0FFUzI1NicsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9XG4gICAgfVxuXG4gICAgbGV0IG1ldGhvZCA9ICdQVVQnXG4gICAgbGV0IHF1ZXJ5ID0gJ2VuY3J5cHRpb24nXG4gICAgbGV0IGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoe1xuICAgICAgcm9vdE5hbWU6ICdTZXJ2ZXJTaWRlRW5jcnlwdGlvbkNvbmZpZ3VyYXRpb24nLFxuICAgICAgcmVuZGVyT3B0czogeyBwcmV0dHk6IGZhbHNlIH0sXG4gICAgICBoZWFkbGVzczogdHJ1ZSxcbiAgICB9KVxuICAgIGxldCBwYXlsb2FkID0gYnVpbGRlci5idWlsZE9iamVjdChlbmNyeXB0aW9uT2JqKVxuXG4gICAgY29uc3QgaGVhZGVycyA9IHt9XG4gICAgaGVhZGVyc1snQ29udGVudC1NRDUnXSA9IHRvTWQ1KHBheWxvYWQpXG5cbiAgICB0aGlzLm1ha2VSZXF1ZXN0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSwgaGVhZGVycyB9LCBwYXlsb2FkLCBbMjAwXSwgJycsIGZhbHNlLCBjYilcbiAgfVxuXG4gIGdldEJ1Y2tldEVuY3J5cHRpb24oYnVja2V0TmFtZSwgY2IpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzRnVuY3Rpb24oY2IpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdjYWxsYmFjayBzaG91bGQgYmUgb2YgdHlwZSBcImZ1bmN0aW9uXCInKVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ2VuY3J5cHRpb24nXG5cbiAgICB0aGlzLm1ha2VSZXF1ZXN0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9LCAnJywgWzIwMF0sICcnLCB0cnVlLCAoZSwgcmVzcG9uc2UpID0+IHtcbiAgICAgIGlmIChlKSB7XG4gICAgICAgIHJldHVybiBjYihlKVxuICAgICAgfVxuXG4gICAgICBsZXQgYnVja2V0RW5jQ29uZmlnID0gQnVmZmVyLmZyb20oJycpXG4gICAgICBwaXBlc2V0dXAocmVzcG9uc2UsIHRyYW5zZm9ybWVycy5idWNrZXRFbmNyeXB0aW9uVHJhbnNmb3JtZXIoKSlcbiAgICAgICAgLm9uKCdkYXRhJywgKGRhdGEpID0+IHtcbiAgICAgICAgICBidWNrZXRFbmNDb25maWcgPSBkYXRhXG4gICAgICAgIH0pXG4gICAgICAgIC5vbignZXJyb3InLCBjYilcbiAgICAgICAgLm9uKCdlbmQnLCAoKSA9PiB7XG4gICAgICAgICAgY2IobnVsbCwgYnVja2V0RW5jQ29uZmlnKVxuICAgICAgICB9KVxuICAgIH0pXG4gIH1cbiAgcmVtb3ZlQnVja2V0RW5jcnlwdGlvbihidWNrZXROYW1lLCBjYikge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNGdW5jdGlvbihjYikpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ2NhbGxiYWNrIHNob3VsZCBiZSBvZiB0eXBlIFwiZnVuY3Rpb25cIicpXG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdERUxFVEUnXG4gICAgY29uc3QgcXVlcnkgPSAnZW5jcnlwdGlvbidcblxuICAgIHRoaXMubWFrZVJlcXVlc3QoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0sICcnLCBbMjA0XSwgJycsIGZhbHNlLCBjYilcbiAgfVxuXG4gIC8qKlxuICAgKiBJbnRlcm5hbCBtZXRob2QgdG8gdXBsb2FkIGEgcGFydCBkdXJpbmcgY29tcG9zZSBvYmplY3QuXG4gICAqIEBwYXJhbSBwYXJ0Q29uZmlnIF9fb2JqZWN0X18gY29udGFpbnMgdGhlIGZvbGxvd2luZy5cbiAgICogICAgYnVja2V0TmFtZSBfX3N0cmluZ19fXG4gICAqICAgIG9iamVjdE5hbWUgX19zdHJpbmdfX1xuICAgKiAgICB1cGxvYWRJRCBfX3N0cmluZ19fXG4gICAqICAgIHBhcnROdW1iZXIgX19udW1iZXJfX1xuICAgKiAgICBoZWFkZXJzIF9fb2JqZWN0X19cbiAgICogQHBhcmFtIGNiIGNhbGxlZCB3aXRoIG51bGwgaW5jYXNlIG9mIGVycm9yLlxuICAgKi9cbiAgdXBsb2FkUGFydENvcHkocGFydENvbmZpZywgY2IpIHtcbiAgICBjb25zdCB7IGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHVwbG9hZElELCBwYXJ0TnVtYmVyLCBoZWFkZXJzIH0gPSBwYXJ0Q29uZmlnXG5cbiAgICBjb25zdCBtZXRob2QgPSAnUFVUJ1xuICAgIGxldCBxdWVyeSA9IGB1cGxvYWRJZD0ke3VwbG9hZElEfSZwYXJ0TnVtYmVyPSR7cGFydE51bWJlcn1gXG4gICAgY29uc3QgcmVxdWVzdE9wdGlvbnMgPSB7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZTogb2JqZWN0TmFtZSwgcXVlcnksIGhlYWRlcnMgfVxuICAgIHJldHVybiB0aGlzLm1ha2VSZXF1ZXN0KHJlcXVlc3RPcHRpb25zLCAnJywgWzIwMF0sICcnLCB0cnVlLCAoZSwgcmVzcG9uc2UpID0+IHtcbiAgICAgIGxldCBwYXJ0Q29weVJlc3VsdCA9IEJ1ZmZlci5mcm9tKCcnKVxuICAgICAgaWYgKGUpIHtcbiAgICAgICAgcmV0dXJuIGNiKGUpXG4gICAgICB9XG4gICAgICBwaXBlc2V0dXAocmVzcG9uc2UsIHRyYW5zZm9ybWVycy51cGxvYWRQYXJ0VHJhbnNmb3JtZXIoKSlcbiAgICAgICAgLm9uKCdkYXRhJywgKGRhdGEpID0+IHtcbiAgICAgICAgICBwYXJ0Q29weVJlc3VsdCA9IGRhdGFcbiAgICAgICAgfSlcbiAgICAgICAgLm9uKCdlcnJvcicsIGNiKVxuICAgICAgICAub24oJ2VuZCcsICgpID0+IHtcbiAgICAgICAgICBsZXQgdXBsb2FkUGFydENvcHlSZXMgPSB7XG4gICAgICAgICAgICBldGFnOiBzYW5pdGl6ZUVUYWcocGFydENvcHlSZXN1bHQuRVRhZyksXG4gICAgICAgICAgICBrZXk6IG9iamVjdE5hbWUsXG4gICAgICAgICAgICBwYXJ0OiBwYXJ0TnVtYmVyLFxuICAgICAgICAgIH1cblxuICAgICAgICAgIGNiKG51bGwsIHVwbG9hZFBhcnRDb3B5UmVzKVxuICAgICAgICB9KVxuICAgIH0pXG4gIH1cblxuICBjb21wb3NlT2JqZWN0KGRlc3RPYmpDb25maWcgPSB7fSwgc291cmNlT2JqTGlzdCA9IFtdLCBjYikge1xuICAgIGNvbnN0IG1lID0gdGhpcyAvLyBtYW55IGFzeW5jIGZsb3dzLiBzbyBzdG9yZSB0aGUgcmVmLlxuICAgIGNvbnN0IHNvdXJjZUZpbGVzTGVuZ3RoID0gc291cmNlT2JqTGlzdC5sZW5ndGhcblxuICAgIGlmICghQXJyYXkuaXNBcnJheShzb3VyY2VPYmpMaXN0KSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignc291cmNlQ29uZmlnIHNob3VsZCBhbiBhcnJheSBvZiBDb3B5U291cmNlT3B0aW9ucyAnKVxuICAgIH1cbiAgICBpZiAoIShkZXN0T2JqQ29uZmlnIGluc3RhbmNlb2YgQ29weURlc3RpbmF0aW9uT3B0aW9ucykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ2Rlc3RDb25maWcgc2hvdWxkIG9mIHR5cGUgQ29weURlc3RpbmF0aW9uT3B0aW9ucyAnKVxuICAgIH1cblxuICAgIGlmIChzb3VyY2VGaWxlc0xlbmd0aCA8IDEgfHwgc291cmNlRmlsZXNMZW5ndGggPiBQQVJUX0NPTlNUUkFJTlRTLk1BWF9QQVJUU19DT1VOVCkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihcbiAgICAgICAgYFwiVGhlcmUgbXVzdCBiZSBhcyBsZWFzdCBvbmUgYW5kIHVwIHRvICR7UEFSVF9DT05TVFJBSU5UUy5NQVhfUEFSVFNfQ09VTlR9IHNvdXJjZSBvYmplY3RzLmAsXG4gICAgICApXG4gICAgfVxuXG4gICAgaWYgKCFpc0Z1bmN0aW9uKGNiKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignY2FsbGJhY2sgc2hvdWxkIGJlIG9mIHR5cGUgXCJmdW5jdGlvblwiJylcbiAgICB9XG5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHNvdXJjZUZpbGVzTGVuZ3RoOyBpKyspIHtcbiAgICAgIGlmICghc291cmNlT2JqTGlzdFtpXS52YWxpZGF0ZSgpKSB7XG4gICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICghZGVzdE9iakNvbmZpZy52YWxpZGF0ZSgpKSB7XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG5cbiAgICBjb25zdCBnZXRTdGF0T3B0aW9ucyA9IChzcmNDb25maWcpID0+IHtcbiAgICAgIGxldCBzdGF0T3B0cyA9IHt9XG4gICAgICBpZiAoIV8uaXNFbXB0eShzcmNDb25maWcuVmVyc2lvbklEKSkge1xuICAgICAgICBzdGF0T3B0cyA9IHtcbiAgICAgICAgICB2ZXJzaW9uSWQ6IHNyY0NvbmZpZy5WZXJzaW9uSUQsXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHJldHVybiBzdGF0T3B0c1xuICAgIH1cbiAgICBjb25zdCBzcmNPYmplY3RTaXplcyA9IFtdXG4gICAgbGV0IHRvdGFsU2l6ZSA9IDBcbiAgICBsZXQgdG90YWxQYXJ0cyA9IDBcblxuICAgIGNvbnN0IHNvdXJjZU9ialN0YXRzID0gc291cmNlT2JqTGlzdC5tYXAoKHNyY0l0ZW0pID0+XG4gICAgICBtZS5zdGF0T2JqZWN0KHNyY0l0ZW0uQnVja2V0LCBzcmNJdGVtLk9iamVjdCwgZ2V0U3RhdE9wdGlvbnMoc3JjSXRlbSkpLFxuICAgIClcblxuICAgIHJldHVybiBQcm9taXNlLmFsbChzb3VyY2VPYmpTdGF0cylcbiAgICAgIC50aGVuKChzcmNPYmplY3RJbmZvcykgPT4ge1xuICAgICAgICBjb25zdCB2YWxpZGF0ZWRTdGF0cyA9IHNyY09iamVjdEluZm9zLm1hcCgocmVzSXRlbVN0YXQsIGluZGV4KSA9PiB7XG4gICAgICAgICAgY29uc3Qgc3JjQ29uZmlnID0gc291cmNlT2JqTGlzdFtpbmRleF1cblxuICAgICAgICAgIGxldCBzcmNDb3B5U2l6ZSA9IHJlc0l0ZW1TdGF0LnNpemVcbiAgICAgICAgICAvLyBDaGVjayBpZiBhIHNlZ21lbnQgaXMgc3BlY2lmaWVkLCBhbmQgaWYgc28sIGlzIHRoZVxuICAgICAgICAgIC8vIHNlZ21lbnQgd2l0aGluIG9iamVjdCBib3VuZHM/XG4gICAgICAgICAgaWYgKHNyY0NvbmZpZy5NYXRjaFJhbmdlKSB7XG4gICAgICAgICAgICAvLyBTaW5jZSByYW5nZSBpcyBzcGVjaWZpZWQsXG4gICAgICAgICAgICAvLyAgICAwIDw9IHNyYy5zcmNTdGFydCA8PSBzcmMuc3JjRW5kXG4gICAgICAgICAgICAvLyBzbyBvbmx5IGludmFsaWQgY2FzZSB0byBjaGVjayBpczpcbiAgICAgICAgICAgIGNvbnN0IHNyY1N0YXJ0ID0gc3JjQ29uZmlnLlN0YXJ0XG4gICAgICAgICAgICBjb25zdCBzcmNFbmQgPSBzcmNDb25maWcuRW5kXG4gICAgICAgICAgICBpZiAoc3JjRW5kID49IHNyY0NvcHlTaXplIHx8IHNyY1N0YXJ0IDwgMCkge1xuICAgICAgICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKFxuICAgICAgICAgICAgICAgIGBDb3B5U3JjT3B0aW9ucyAke2luZGV4fSBoYXMgaW52YWxpZCBzZWdtZW50LXRvLWNvcHkgWyR7c3JjU3RhcnR9LCAke3NyY0VuZH1dIChzaXplIGlzICR7c3JjQ29weVNpemV9KWAsXG4gICAgICAgICAgICAgIClcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHNyY0NvcHlTaXplID0gc3JjRW5kIC0gc3JjU3RhcnQgKyAxXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gT25seSB0aGUgbGFzdCBzb3VyY2UgbWF5IGJlIGxlc3MgdGhhbiBgYWJzTWluUGFydFNpemVgXG4gICAgICAgICAgaWYgKHNyY0NvcHlTaXplIDwgUEFSVF9DT05TVFJBSU5UUy5BQlNfTUlOX1BBUlRfU0laRSAmJiBpbmRleCA8IHNvdXJjZUZpbGVzTGVuZ3RoIC0gMSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihcbiAgICAgICAgICAgICAgYENvcHlTcmNPcHRpb25zICR7aW5kZXh9IGlzIHRvbyBzbWFsbCAoJHtzcmNDb3B5U2l6ZX0pIGFuZCBpdCBpcyBub3QgdGhlIGxhc3QgcGFydC5gLFxuICAgICAgICAgICAgKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIC8vIElzIGRhdGEgdG8gY29weSB0b28gbGFyZ2U/XG4gICAgICAgICAgdG90YWxTaXplICs9IHNyY0NvcHlTaXplXG4gICAgICAgICAgaWYgKHRvdGFsU2l6ZSA+IFBBUlRfQ09OU1RSQUlOVFMuTUFYX01VTFRJUEFSVF9QVVRfT0JKRUNUX1NJWkUpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYENhbm5vdCBjb21wb3NlIGFuIG9iamVjdCBvZiBzaXplICR7dG90YWxTaXplfSAoPiA1VGlCKWApXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gcmVjb3JkIHNvdXJjZSBzaXplXG4gICAgICAgICAgc3JjT2JqZWN0U2l6ZXNbaW5kZXhdID0gc3JjQ29weVNpemVcblxuICAgICAgICAgIC8vIGNhbGN1bGF0ZSBwYXJ0cyBuZWVkZWQgZm9yIGN1cnJlbnQgc291cmNlXG4gICAgICAgICAgdG90YWxQYXJ0cyArPSBwYXJ0c1JlcXVpcmVkKHNyY0NvcHlTaXplKVxuICAgICAgICAgIC8vIERvIHdlIG5lZWQgbW9yZSBwYXJ0cyB0aGFuIHdlIGFyZSBhbGxvd2VkP1xuICAgICAgICAgIGlmICh0b3RhbFBhcnRzID4gUEFSVF9DT05TVFJBSU5UUy5NQVhfUEFSVFNfQ09VTlQpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoXG4gICAgICAgICAgICAgIGBZb3VyIHByb3Bvc2VkIGNvbXBvc2Ugb2JqZWN0IHJlcXVpcmVzIG1vcmUgdGhhbiAke1BBUlRfQ09OU1RSQUlOVFMuTUFYX1BBUlRTX0NPVU5UfSBwYXJ0c2AsXG4gICAgICAgICAgICApXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcmV0dXJuIHJlc0l0ZW1TdGF0XG4gICAgICAgIH0pXG5cbiAgICAgICAgaWYgKCh0b3RhbFBhcnRzID09PSAxICYmIHRvdGFsU2l6ZSA8PSBQQVJUX0NPTlNUUkFJTlRTLk1BWF9QQVJUX1NJWkUpIHx8IHRvdGFsU2l6ZSA9PT0gMCkge1xuICAgICAgICAgIHJldHVybiB0aGlzLmNvcHlPYmplY3Qoc291cmNlT2JqTGlzdFswXSwgZGVzdE9iakNvbmZpZywgY2IpIC8vIHVzZSBjb3B5T2JqZWN0VjJcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIHByZXNlcnZlIGV0YWcgdG8gYXZvaWQgbW9kaWZpY2F0aW9uIG9mIG9iamVjdCB3aGlsZSBjb3B5aW5nLlxuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHNvdXJjZUZpbGVzTGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICBzb3VyY2VPYmpMaXN0W2ldLk1hdGNoRVRhZyA9IHZhbGlkYXRlZFN0YXRzW2ldLmV0YWdcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHNwbGl0UGFydFNpemVMaXN0ID0gdmFsaWRhdGVkU3RhdHMubWFwKChyZXNJdGVtU3RhdCwgaWR4KSA9PiB7XG4gICAgICAgICAgY29uc3QgY2FsU2l6ZSA9IGNhbGN1bGF0ZUV2ZW5TcGxpdHMoc3JjT2JqZWN0U2l6ZXNbaWR4XSwgc291cmNlT2JqTGlzdFtpZHhdKVxuICAgICAgICAgIHJldHVybiBjYWxTaXplXG4gICAgICAgIH0pXG5cbiAgICAgICAgZnVuY3Rpb24gZ2V0VXBsb2FkUGFydENvbmZpZ0xpc3QodXBsb2FkSWQpIHtcbiAgICAgICAgICBjb25zdCB1cGxvYWRQYXJ0Q29uZmlnTGlzdCA9IFtdXG5cbiAgICAgICAgICBzcGxpdFBhcnRTaXplTGlzdC5mb3JFYWNoKChzcGxpdFNpemUsIHNwbGl0SW5kZXgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHsgc3RhcnRJbmRleDogc3RhcnRJZHgsIGVuZEluZGV4OiBlbmRJZHgsIG9iakluZm86IG9iakNvbmZpZyB9ID0gc3BsaXRTaXplXG5cbiAgICAgICAgICAgIGxldCBwYXJ0SW5kZXggPSBzcGxpdEluZGV4ICsgMSAvLyBwYXJ0IGluZGV4IHN0YXJ0cyBmcm9tIDEuXG4gICAgICAgICAgICBjb25zdCB0b3RhbFVwbG9hZHMgPSBBcnJheS5mcm9tKHN0YXJ0SWR4KVxuXG4gICAgICAgICAgICBjb25zdCBoZWFkZXJzID0gc291cmNlT2JqTGlzdFtzcGxpdEluZGV4XS5nZXRIZWFkZXJzKClcblxuICAgICAgICAgICAgdG90YWxVcGxvYWRzLmZvckVhY2goKHNwbGl0U3RhcnQsIHVwbGRDdHJJZHgpID0+IHtcbiAgICAgICAgICAgICAgbGV0IHNwbGl0RW5kID0gZW5kSWR4W3VwbGRDdHJJZHhdXG5cbiAgICAgICAgICAgICAgY29uc3Qgc291cmNlT2JqID0gYCR7b2JqQ29uZmlnLkJ1Y2tldH0vJHtvYmpDb25maWcuT2JqZWN0fWBcbiAgICAgICAgICAgICAgaGVhZGVyc1sneC1hbXotY29weS1zb3VyY2UnXSA9IGAke3NvdXJjZU9ian1gXG4gICAgICAgICAgICAgIGhlYWRlcnNbJ3gtYW16LWNvcHktc291cmNlLXJhbmdlJ10gPSBgYnl0ZXM9JHtzcGxpdFN0YXJ0fS0ke3NwbGl0RW5kfWBcblxuICAgICAgICAgICAgICBjb25zdCB1cGxvYWRQYXJ0Q29uZmlnID0ge1xuICAgICAgICAgICAgICAgIGJ1Y2tldE5hbWU6IGRlc3RPYmpDb25maWcuQnVja2V0LFxuICAgICAgICAgICAgICAgIG9iamVjdE5hbWU6IGRlc3RPYmpDb25maWcuT2JqZWN0LFxuICAgICAgICAgICAgICAgIHVwbG9hZElEOiB1cGxvYWRJZCxcbiAgICAgICAgICAgICAgICBwYXJ0TnVtYmVyOiBwYXJ0SW5kZXgsXG4gICAgICAgICAgICAgICAgaGVhZGVyczogaGVhZGVycyxcbiAgICAgICAgICAgICAgICBzb3VyY2VPYmo6IHNvdXJjZU9iaixcbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIHVwbG9hZFBhcnRDb25maWdMaXN0LnB1c2godXBsb2FkUGFydENvbmZpZylcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgfSlcblxuICAgICAgICAgIHJldHVybiB1cGxvYWRQYXJ0Q29uZmlnTGlzdFxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcGVyZm9ybVVwbG9hZFBhcnRzID0gKHVwbG9hZElkKSA9PiB7XG4gICAgICAgICAgY29uc3QgdXBsb2FkTGlzdCA9IGdldFVwbG9hZFBhcnRDb25maWdMaXN0KHVwbG9hZElkKVxuXG4gICAgICAgICAgYXN5bmMubWFwKHVwbG9hZExpc3QsIG1lLnVwbG9hZFBhcnRDb3B5LmJpbmQobWUpLCAoZXJyLCByZXMpID0+IHtcbiAgICAgICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICAgICAgdGhpcy5hYm9ydE11bHRpcGFydFVwbG9hZChkZXN0T2JqQ29uZmlnLkJ1Y2tldCwgZGVzdE9iakNvbmZpZy5PYmplY3QsIHVwbG9hZElkKS50aGVuKFxuICAgICAgICAgICAgICAgICgpID0+IGNiKCksXG4gICAgICAgICAgICAgICAgKGVycikgPT4gY2IoZXJyKSxcbiAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICByZXR1cm5cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0IHBhcnRzRG9uZSA9IHJlcy5tYXAoKHBhcnRDb3B5KSA9PiAoeyBldGFnOiBwYXJ0Q29weS5ldGFnLCBwYXJ0OiBwYXJ0Q29weS5wYXJ0IH0pKVxuICAgICAgICAgICAgcmV0dXJuIG1lLmNvbXBsZXRlTXVsdGlwYXJ0VXBsb2FkKGRlc3RPYmpDb25maWcuQnVja2V0LCBkZXN0T2JqQ29uZmlnLk9iamVjdCwgdXBsb2FkSWQsIHBhcnRzRG9uZSkudGhlbihcbiAgICAgICAgICAgICAgKHJlc3VsdCkgPT4gY2IobnVsbCwgcmVzdWx0KSxcbiAgICAgICAgICAgICAgKGVycikgPT4gY2IoZXJyKSxcbiAgICAgICAgICAgIClcbiAgICAgICAgICB9KVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgbmV3VXBsb2FkSGVhZGVycyA9IGRlc3RPYmpDb25maWcuZ2V0SGVhZGVycygpXG5cbiAgICAgICAgbWUuaW5pdGlhdGVOZXdNdWx0aXBhcnRVcGxvYWQoZGVzdE9iakNvbmZpZy5CdWNrZXQsIGRlc3RPYmpDb25maWcuT2JqZWN0LCBuZXdVcGxvYWRIZWFkZXJzKS50aGVuKFxuICAgICAgICAgICh1cGxvYWRJZCkgPT4ge1xuICAgICAgICAgICAgcGVyZm9ybVVwbG9hZFBhcnRzKHVwbG9hZElkKVxuICAgICAgICAgIH0sXG4gICAgICAgICAgKGVycikgPT4ge1xuICAgICAgICAgICAgY2IoZXJyLCBudWxsKVxuICAgICAgICAgIH0sXG4gICAgICAgIClcbiAgICAgIH0pXG4gICAgICAuY2F0Y2goKGVycm9yKSA9PiB7XG4gICAgICAgIGNiKGVycm9yLCBudWxsKVxuICAgICAgfSlcbiAgfVxuICBzZWxlY3RPYmplY3RDb250ZW50KGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHNlbGVjdE9wdHMgPSB7fSwgY2IpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoYEludmFsaWQgYnVja2V0IG5hbWU6ICR7YnVja2V0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIV8uaXNFbXB0eShzZWxlY3RPcHRzKSkge1xuICAgICAgaWYgKCFpc1N0cmluZyhzZWxlY3RPcHRzLmV4cHJlc3Npb24pKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3NxbEV4cHJlc3Npb24gc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgICB9XG4gICAgICBpZiAoIV8uaXNFbXB0eShzZWxlY3RPcHRzLmlucHV0U2VyaWFsaXphdGlvbikpIHtcbiAgICAgICAgaWYgKCFpc09iamVjdChzZWxlY3RPcHRzLmlucHV0U2VyaWFsaXphdGlvbikpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdpbnB1dFNlcmlhbGl6YXRpb24gc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2lucHV0U2VyaWFsaXphdGlvbiBpcyByZXF1aXJlZCcpXG4gICAgICB9XG4gICAgICBpZiAoIV8uaXNFbXB0eShzZWxlY3RPcHRzLm91dHB1dFNlcmlhbGl6YXRpb24pKSB7XG4gICAgICAgIGlmICghaXNPYmplY3Qoc2VsZWN0T3B0cy5vdXRwdXRTZXJpYWxpemF0aW9uKSkge1xuICAgICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ291dHB1dFNlcmlhbGl6YXRpb24gc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ291dHB1dFNlcmlhbGl6YXRpb24gaXMgcmVxdWlyZWQnKVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCd2YWxpZCBzZWxlY3QgY29uZmlndXJhdGlvbiBpcyByZXF1aXJlZCcpXG4gICAgfVxuXG4gICAgaWYgKCFpc0Z1bmN0aW9uKGNiKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignY2FsbGJhY2sgc2hvdWxkIGJlIG9mIHR5cGUgXCJmdW5jdGlvblwiJylcbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2QgPSAnUE9TVCdcbiAgICBsZXQgcXVlcnkgPSBgc2VsZWN0YFxuICAgIHF1ZXJ5ICs9ICcmc2VsZWN0LXR5cGU9MidcblxuICAgIGNvbnN0IGNvbmZpZyA9IFtcbiAgICAgIHtcbiAgICAgICAgRXhwcmVzc2lvbjogc2VsZWN0T3B0cy5leHByZXNzaW9uLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgRXhwcmVzc2lvblR5cGU6IHNlbGVjdE9wdHMuZXhwcmVzc2lvblR5cGUgfHwgJ1NRTCcsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBJbnB1dFNlcmlhbGl6YXRpb246IFtzZWxlY3RPcHRzLmlucHV0U2VyaWFsaXphdGlvbl0sXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBPdXRwdXRTZXJpYWxpemF0aW9uOiBbc2VsZWN0T3B0cy5vdXRwdXRTZXJpYWxpemF0aW9uXSxcbiAgICAgIH0sXG4gICAgXVxuXG4gICAgLy8gT3B0aW9uYWxcbiAgICBpZiAoc2VsZWN0T3B0cy5yZXF1ZXN0UHJvZ3Jlc3MpIHtcbiAgICAgIGNvbmZpZy5wdXNoKHsgUmVxdWVzdFByb2dyZXNzOiBzZWxlY3RPcHRzLnJlcXVlc3RQcm9ncmVzcyB9KVxuICAgIH1cbiAgICAvLyBPcHRpb25hbFxuICAgIGlmIChzZWxlY3RPcHRzLnNjYW5SYW5nZSkge1xuICAgICAgY29uZmlnLnB1c2goeyBTY2FuUmFuZ2U6IHNlbGVjdE9wdHMuc2NhblJhbmdlIH0pXG4gICAgfVxuXG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7XG4gICAgICByb290TmFtZTogJ1NlbGVjdE9iamVjdENvbnRlbnRSZXF1ZXN0JyxcbiAgICAgIHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9LFxuICAgICAgaGVhZGxlc3M6IHRydWUsXG4gICAgfSlcbiAgICBjb25zdCBwYXlsb2FkID0gYnVpbGRlci5idWlsZE9iamVjdChjb25maWcpXG5cbiAgICB0aGlzLm1ha2VSZXF1ZXN0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSB9LCBwYXlsb2FkLCBbMjAwXSwgJycsIHRydWUsIChlLCByZXNwb25zZSkgPT4ge1xuICAgICAgaWYgKGUpIHtcbiAgICAgICAgcmV0dXJuIGNiKGUpXG4gICAgICB9XG5cbiAgICAgIGxldCBzZWxlY3RSZXN1bHRcbiAgICAgIHBpcGVzZXR1cChyZXNwb25zZSwgdHJhbnNmb3JtZXJzLnNlbGVjdE9iamVjdENvbnRlbnRUcmFuc2Zvcm1lcigpKVxuICAgICAgICAub24oJ2RhdGEnLCAoZGF0YSkgPT4ge1xuICAgICAgICAgIHNlbGVjdFJlc3VsdCA9IHBhcnNlU2VsZWN0T2JqZWN0Q29udGVudFJlc3BvbnNlKGRhdGEpXG4gICAgICAgIH0pXG4gICAgICAgIC5vbignZXJyb3InLCBjYilcbiAgICAgICAgLm9uKCdlbmQnLCAoKSA9PiB7XG4gICAgICAgICAgY2IobnVsbCwgc2VsZWN0UmVzdWx0KVxuICAgICAgICB9KVxuICAgIH0pXG4gIH1cbn1cblxuLy8gUHJvbWlzaWZ5IHZhcmlvdXMgcHVibGljLWZhY2luZyBBUElzIG9uIHRoZSBDbGllbnQgbW9kdWxlLlxuQ2xpZW50LnByb3RvdHlwZS5jb3B5T2JqZWN0ID0gcHJvbWlzaWZ5KENsaWVudC5wcm90b3R5cGUuY29weU9iamVjdClcbkNsaWVudC5wcm90b3R5cGUucmVtb3ZlT2JqZWN0cyA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLnJlbW92ZU9iamVjdHMpXG5cbkNsaWVudC5wcm90b3R5cGUucHJlc2lnbmVkVXJsID0gcHJvbWlzaWZ5KENsaWVudC5wcm90b3R5cGUucHJlc2lnbmVkVXJsKVxuQ2xpZW50LnByb3RvdHlwZS5wcmVzaWduZWRHZXRPYmplY3QgPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5wcmVzaWduZWRHZXRPYmplY3QpXG5DbGllbnQucHJvdG90eXBlLnByZXNpZ25lZFB1dE9iamVjdCA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLnByZXNpZ25lZFB1dE9iamVjdClcbkNsaWVudC5wcm90b3R5cGUucHJlc2lnbmVkUG9zdFBvbGljeSA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLnByZXNpZ25lZFBvc3RQb2xpY3kpXG5DbGllbnQucHJvdG90eXBlLmdldEJ1Y2tldE5vdGlmaWNhdGlvbiA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLmdldEJ1Y2tldE5vdGlmaWNhdGlvbilcbkNsaWVudC5wcm90b3R5cGUuc2V0QnVja2V0Tm90aWZpY2F0aW9uID0gcHJvbWlzaWZ5KENsaWVudC5wcm90b3R5cGUuc2V0QnVja2V0Tm90aWZpY2F0aW9uKVxuQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVBbGxCdWNrZXROb3RpZmljYXRpb24gPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVBbGxCdWNrZXROb3RpZmljYXRpb24pXG5DbGllbnQucHJvdG90eXBlLnJlbW92ZUluY29tcGxldGVVcGxvYWQgPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVJbmNvbXBsZXRlVXBsb2FkKVxuQ2xpZW50LnByb3RvdHlwZS5zZXRCdWNrZXRUYWdnaW5nID0gcHJvbWlzaWZ5KENsaWVudC5wcm90b3R5cGUuc2V0QnVja2V0VGFnZ2luZylcbkNsaWVudC5wcm90b3R5cGUucmVtb3ZlQnVja2V0VGFnZ2luZyA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLnJlbW92ZUJ1Y2tldFRhZ2dpbmcpXG5DbGllbnQucHJvdG90eXBlLnNldE9iamVjdFRhZ2dpbmcgPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5zZXRPYmplY3RUYWdnaW5nKVxuQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVPYmplY3RUYWdnaW5nID0gcHJvbWlzaWZ5KENsaWVudC5wcm90b3R5cGUucmVtb3ZlT2JqZWN0VGFnZ2luZylcbkNsaWVudC5wcm90b3R5cGUuc2V0QnVja2V0TGlmZWN5Y2xlID0gcHJvbWlzaWZ5KENsaWVudC5wcm90b3R5cGUuc2V0QnVja2V0TGlmZWN5Y2xlKVxuQ2xpZW50LnByb3RvdHlwZS5nZXRCdWNrZXRMaWZlY3ljbGUgPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5nZXRCdWNrZXRMaWZlY3ljbGUpXG5DbGllbnQucHJvdG90eXBlLnJlbW92ZUJ1Y2tldExpZmVjeWNsZSA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLnJlbW92ZUJ1Y2tldExpZmVjeWNsZSlcbkNsaWVudC5wcm90b3R5cGUuZ2V0T2JqZWN0UmV0ZW50aW9uID0gcHJvbWlzaWZ5KENsaWVudC5wcm90b3R5cGUuZ2V0T2JqZWN0UmV0ZW50aW9uKVxuQ2xpZW50LnByb3RvdHlwZS5zZXRCdWNrZXRFbmNyeXB0aW9uID0gcHJvbWlzaWZ5KENsaWVudC5wcm90b3R5cGUuc2V0QnVja2V0RW5jcnlwdGlvbilcbkNsaWVudC5wcm90b3R5cGUuZ2V0QnVja2V0RW5jcnlwdGlvbiA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLmdldEJ1Y2tldEVuY3J5cHRpb24pXG5DbGllbnQucHJvdG90eXBlLnJlbW92ZUJ1Y2tldEVuY3J5cHRpb24gPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVCdWNrZXRFbmNyeXB0aW9uKVxuQ2xpZW50LnByb3RvdHlwZS5jb21wb3NlT2JqZWN0ID0gcHJvbWlzaWZ5KENsaWVudC5wcm90b3R5cGUuY29tcG9zZU9iamVjdClcbkNsaWVudC5wcm90b3R5cGUuc2VsZWN0T2JqZWN0Q29udGVudCA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLnNlbGVjdE9iamVjdENvbnRlbnQpXG5cbi8vIHJlZmFjdG9yZWQgQVBJIHVzZSBwcm9taXNlIGludGVybmFsbHlcbkNsaWVudC5wcm90b3R5cGUubWFrZUJ1Y2tldCA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUubWFrZUJ1Y2tldClcbkNsaWVudC5wcm90b3R5cGUuYnVja2V0RXhpc3RzID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5idWNrZXRFeGlzdHMpXG5DbGllbnQucHJvdG90eXBlLnJlbW92ZUJ1Y2tldCA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUucmVtb3ZlQnVja2V0KVxuQ2xpZW50LnByb3RvdHlwZS5saXN0QnVja2V0cyA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUubGlzdEJ1Y2tldHMpXG5cbkNsaWVudC5wcm90b3R5cGUuZ2V0T2JqZWN0ID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5nZXRPYmplY3QpXG5DbGllbnQucHJvdG90eXBlLmZHZXRPYmplY3QgPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLmZHZXRPYmplY3QpXG5DbGllbnQucHJvdG90eXBlLmdldFBhcnRpYWxPYmplY3QgPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLmdldFBhcnRpYWxPYmplY3QpXG5DbGllbnQucHJvdG90eXBlLnN0YXRPYmplY3QgPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLnN0YXRPYmplY3QpXG5DbGllbnQucHJvdG90eXBlLnB1dE9iamVjdFJldGVudGlvbiA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUucHV0T2JqZWN0UmV0ZW50aW9uKVxuQ2xpZW50LnByb3RvdHlwZS5wdXRPYmplY3QgPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLnB1dE9iamVjdClcbkNsaWVudC5wcm90b3R5cGUuZlB1dE9iamVjdCA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUuZlB1dE9iamVjdClcbkNsaWVudC5wcm90b3R5cGUucmVtb3ZlT2JqZWN0ID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVPYmplY3QpXG5cbkNsaWVudC5wcm90b3R5cGUucmVtb3ZlQnVja2V0UmVwbGljYXRpb24gPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLnJlbW92ZUJ1Y2tldFJlcGxpY2F0aW9uKVxuQ2xpZW50LnByb3RvdHlwZS5zZXRCdWNrZXRSZXBsaWNhdGlvbiA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUuc2V0QnVja2V0UmVwbGljYXRpb24pXG5DbGllbnQucHJvdG90eXBlLmdldEJ1Y2tldFJlcGxpY2F0aW9uID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5nZXRCdWNrZXRSZXBsaWNhdGlvbilcbkNsaWVudC5wcm90b3R5cGUuZ2V0T2JqZWN0TGVnYWxIb2xkID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5nZXRPYmplY3RMZWdhbEhvbGQpXG5DbGllbnQucHJvdG90eXBlLnNldE9iamVjdExlZ2FsSG9sZCA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUuc2V0T2JqZWN0TGVnYWxIb2xkKVxuQ2xpZW50LnByb3RvdHlwZS5nZXRCdWNrZXRUYWdnaW5nID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5nZXRCdWNrZXRUYWdnaW5nKVxuQ2xpZW50LnByb3RvdHlwZS5nZXRPYmplY3RUYWdnaW5nID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5nZXRPYmplY3RUYWdnaW5nKVxuQ2xpZW50LnByb3RvdHlwZS5zZXRPYmplY3RMb2NrQ29uZmlnID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5zZXRPYmplY3RMb2NrQ29uZmlnKVxuQ2xpZW50LnByb3RvdHlwZS5nZXRPYmplY3RMb2NrQ29uZmlnID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5nZXRPYmplY3RMb2NrQ29uZmlnKVxuQ2xpZW50LnByb3RvdHlwZS5nZXRCdWNrZXRQb2xpY3kgPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLmdldEJ1Y2tldFBvbGljeSlcbkNsaWVudC5wcm90b3R5cGUuc2V0QnVja2V0UG9saWN5ID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5zZXRCdWNrZXRQb2xpY3kpXG5DbGllbnQucHJvdG90eXBlLmdldEJ1Y2tldFZlcnNpb25pbmcgPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLmdldEJ1Y2tldFZlcnNpb25pbmcpXG5DbGllbnQucHJvdG90eXBlLnNldEJ1Y2tldFZlcnNpb25pbmcgPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLnNldEJ1Y2tldFZlcnNpb25pbmcpXG4iXSwibWFwcGluZ3MiOiJBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQSxPQUFPLEtBQUtBLE1BQU07QUFFbEIsT0FBT0MsS0FBSyxNQUFNLE9BQU87QUFDekIsT0FBT0MsQ0FBQyxNQUFNLFFBQVE7QUFDdEIsT0FBTyxLQUFLQyxXQUFXLE1BQU0sY0FBYztBQUMzQyxTQUFTQyxXQUFXLFFBQVEsY0FBYztBQUMxQyxPQUFPQyxNQUFNLE1BQU0sUUFBUTtBQUUzQixPQUFPLEtBQUtDLE1BQU0sTUFBTSxjQUFhO0FBQ3JDLFNBQVNDLHNCQUFzQixFQUFFQyxpQkFBaUIsUUFBUSxlQUFjO0FBQ3hFLFNBQVNDLFdBQVcsUUFBUSw0QkFBMkI7QUFDdkQsU0FBU0MsV0FBVyxRQUFRLHVCQUFzQjtBQUNsRCxTQUFTQyxjQUFjLFFBQVEsZ0NBQStCO0FBQzlELFNBQ0VDLG1CQUFtQixFQUNuQkMsZUFBZSxFQUNmQyxRQUFRLEVBQ1JDLGtCQUFrQixFQUNsQkMsWUFBWSxFQUNa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