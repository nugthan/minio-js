"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
var _exportNames = {
  Client: true,
  CopyConditions: true,
  PostPolicy: true
};
var Stream = _interopRequireWildcard(require("stream"), true);
var _async = require("async");
var _lodash = require("lodash");
var querystring = _interopRequireWildcard(require("query-string"), true);
var _webEncoding = require("web-encoding");
var _xml2js = require("xml2js");
var errors = _interopRequireWildcard(require("./errors.js"), true);
Object.keys(errors).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === errors[key]) return;
  exports[key] = errors[key];
});
var _helpers = require("./helpers.js");
Object.keys(_helpers).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _helpers[key]) return;
  exports[key] = _helpers[key];
});
var _callbackify = require("./internal/callbackify.js");
var _client = require("./internal/client.js");
var _copyConditions = require("./internal/copy-conditions.js");
exports.CopyConditions = _copyConditions.CopyConditions;
var _helper = require("./internal/helper.js");
var _postPolicy = require("./internal/post-policy.js");
exports.PostPolicy = _postPolicy.PostPolicy;
var _notification = require("./notification.js");
Object.keys(_notification).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _notification[key]) return;
  exports[key] = _notification[key];
});
var _promisify = require("./promisify.js");
var _signing = require("./signing.js");
var transformers = _interopRequireWildcard(require("./transformers.js"), true);
var _xmlParsers = require("./xml-parsers.js");
function _getRequireWildcardCache(nodeInterop) { if (typeof WeakMap !== "function") return null; var cacheBabelInterop = new WeakMap(); var cacheNodeInterop = new WeakMap(); return (_getRequireWildcardCache = function (nodeInterop) { return nodeInterop ? cacheNodeInterop : cacheBabelInterop; })(nodeInterop); }
function _interopRequireWildcard(obj, nodeInterop) { if (!nodeInterop && obj && obj.__esModule) { return obj; } if (obj === null || typeof obj !== "object" && typeof obj !== "function") { return { default: obj }; } var cache = _getRequireWildcardCache(nodeInterop); if (cache && cache.has(obj)) { return cache.get(obj); } var newObj = {}; var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var key in obj) { if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) { var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null; if (desc && (desc.get || desc.set)) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } newObj.default = obj; if (cache) { cache.set(obj, newObj); } return newObj; }
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

class Client extends _client.TypedClient {
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
    if (!(0, _helper.isString)(appName)) {
      throw new TypeError(`Invalid appName: ${appName}`);
    }
    if (appName.trim() === '') {
      throw new errors.InvalidArgumentError('Input appName cannot be empty.');
    }
    if (!(0, _helper.isString)(appVersion)) {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.IsValidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isFunction)(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    var removeUploadId;
    _async.during(cb => {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isString)(srcObject)) {
      throw new TypeError('srcObject should be of type "string"');
    }
    if (srcObject === '') {
      throw new errors.InvalidPrefixError(`Empty source prefix`);
    }
    if (conditions !== null && !(conditions instanceof _copyConditions.CopyConditions)) {
      throw new TypeError('conditions should be of type "CopyConditions"');
    }
    var headers = {};
    headers['x-amz-copy-source'] = (0, _helper.uriResourceEscape)(srcObject);
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
      (0, _helper.pipesetup)(response, transformer).on('error', e => cb(e)).on('data', data => cb(null, data));
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
    if (!(sourceConfig instanceof _helpers.CopySourceOptions)) {
      throw new errors.InvalidArgumentError('sourceConfig should of type CopySourceOptions ');
    }
    if (!(destConfig instanceof _helpers.CopyDestinationOptions)) {
      throw new errors.InvalidArgumentError('destConfig should of type CopyDestinationOptions ');
    }
    if (!destConfig.validate()) {
      return false;
    }
    if (!destConfig.validate()) {
      return false;
    }
    if (!(0, _helper.isFunction)(cb)) {
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
      (0, _helper.pipesetup)(response, transformer).on('error', e => cb(e)).on('data', data => {
        const resHeaders = response.headers;
        const copyObjResponse = {
          Bucket: destConfig.Bucket,
          Key: destConfig.Object,
          LastModified: data.LastModified,
          MetaData: (0, _helper.extractMetadata)(resHeaders),
          VersionId: (0, _helper.getVersionId)(resHeaders),
          SourceVersionId: (0, _helper.getSourceVersionId)(resHeaders),
          Etag: (0, _helper.sanitizeETag)(resHeaders.etag),
          Size: +resHeaders['content-length']
        };
        return cb(null, copyObjResponse);
      });
    });
  }

  // Backward compatibility for Copy Object API.
  copyObject(...allArgs) {
    if (allArgs[0] instanceof _helpers.CopySourceOptions && allArgs[1] instanceof _helpers.CopyDestinationOptions) {
      return this.copyObjectV2(...arguments);
    }
    return this.copyObjectV1(...arguments);
  }

  // list a batch of objects
  listObjectsQuery(bucketName, prefix, marker, listQueryOpts = {}) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isString)(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (!(0, _helper.isString)(marker)) {
      throw new TypeError('marker should be of type "string"');
    }
    let {
      Delimiter,
      MaxKeys,
      IncludeVersion
    } = listQueryOpts;
    if (!(0, _helper.isObject)(listQueryOpts)) {
      throw new TypeError('listQueryOpts should be of type "object"');
    }
    if (!(0, _helper.isString)(Delimiter)) {
      throw new TypeError('Delimiter should be of type "string"');
    }
    if (!(0, _helper.isNumber)(MaxKeys)) {
      throw new TypeError('MaxKeys should be of type "number"');
    }
    const queries = [];
    // escape every value in query string, except maxKeys
    queries.push(`prefix=${(0, _helper.uriEscape)(prefix)}`);
    queries.push(`delimiter=${(0, _helper.uriEscape)(Delimiter)}`);
    queries.push(`encoding-type=url`);
    if (IncludeVersion) {
      queries.push(`versions`);
    }
    if (marker) {
      marker = (0, _helper.uriEscape)(marker);
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
      (0, _helper.pipesetup)(response, transformer);
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidPrefix)(prefix)) {
      throw new errors.InvalidPrefixError(`Invalid prefix : ${prefix}`);
    }
    if (!(0, _helper.isString)(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (!(0, _helper.isBoolean)(recursive)) {
      throw new TypeError('recursive should be of type "boolean"');
    }
    if (!(0, _helper.isObject)(listOpts)) {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isString)(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (!(0, _helper.isString)(continuationToken)) {
      throw new TypeError('continuationToken should be of type "string"');
    }
    if (!(0, _helper.isString)(delimiter)) {
      throw new TypeError('delimiter should be of type "string"');
    }
    if (!(0, _helper.isNumber)(maxKeys)) {
      throw new TypeError('maxKeys should be of type "number"');
    }
    if (!(0, _helper.isString)(startAfter)) {
      throw new TypeError('startAfter should be of type "string"');
    }
    var queries = [];

    // Call for listing objects v2 API
    queries.push(`list-type=2`);
    queries.push(`encoding-type=url`);

    // escape every value in query string, except maxKeys
    queries.push(`prefix=${(0, _helper.uriEscape)(prefix)}`);
    queries.push(`delimiter=${(0, _helper.uriEscape)(delimiter)}`);
    if (continuationToken) {
      continuationToken = (0, _helper.uriEscape)(continuationToken);
      queries.push(`continuation-token=${continuationToken}`);
    }
    // Set start-after
    if (startAfter) {
      startAfter = (0, _helper.uriEscape)(startAfter);
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
      (0, _helper.pipesetup)(response, transformer);
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidPrefix)(prefix)) {
      throw new errors.InvalidPrefixError(`Invalid prefix : ${prefix}`);
    }
    if (!(0, _helper.isString)(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (!(0, _helper.isBoolean)(recursive)) {
      throw new TypeError('recursive should be of type "boolean"');
    }
    if (!(0, _helper.isString)(startAfter)) {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!Array.isArray(objectsList)) {
      throw new errors.InvalidArgumentError('objectsList should be a list');
    }
    if (!(0, _helper.isFunction)(cb)) {
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
    const encoder = new _webEncoding.TextEncoder();
    const batchResults = [];
    _async.eachSeries(result.listOfList, (list, batchCb) => {
      var objects = [];
      list.forEach(function (value) {
        if ((0, _helper.isObject)(value)) {
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
      const builder = new _xml2js.Builder({
        headless: true
      });
      let payload = builder.buildObject(deleteObjects);
      payload = Buffer.from(encoder.encode(payload));
      const headers = {};
      headers['Content-MD5'] = (0, _helper.toMd5)(payload);
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
        (0, _helper.pipesetup)(response, transformers.removeObjectsTransformer()).on('data', data => {
          removeObjectsResult = data;
        }).on('error', e => {
          return batchCb(e, null);
        }).on('end', () => {
          batchResults.push(removeObjectsResult);
          return batchCb(null, removeObjectsResult);
        });
      });
    }, () => {
      cb(null, _lodash.flatten(batchResults));
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
    if ((0, _helper.isFunction)(requestDate)) {
      cb = requestDate;
      requestDate = new Date();
    }
    if ((0, _helper.isFunction)(reqParams)) {
      cb = reqParams;
      reqParams = {};
      requestDate = new Date();
    }
    if ((0, _helper.isFunction)(expires)) {
      cb = expires;
      reqParams = {};
      expires = 24 * 60 * 60 * 7; // 7 days in seconds
      requestDate = new Date();
    }
    if (!(0, _helper.isNumber)(expires)) {
      throw new TypeError('expires should be of type "number"');
    }
    if (!(0, _helper.isObject)(reqParams)) {
      throw new TypeError('reqParams should be of type "object"');
    }
    if (!(0, _helper.isValidDate)(requestDate)) {
      throw new TypeError('requestDate should be of type "Date" and valid');
    }
    if (!(0, _helper.isFunction)(cb)) {
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
        url = (0, _signing.presignSignatureV4)(reqOptions, this.accessKey, this.secretKey, this.sessionToken, region, requestDate, expires);
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if ((0, _helper.isFunction)(respHeaders)) {
      cb = respHeaders;
      respHeaders = {};
      requestDate = new Date();
    }
    var validRespHeaders = ['response-content-type', 'response-content-language', 'response-expires', 'response-cache-control', 'response-content-disposition', 'response-content-encoding'];
    validRespHeaders.forEach(header => {
      if (respHeaders !== undefined && respHeaders[header] !== undefined && !(0, _helper.isString)(respHeaders[header])) {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    return this.presignedUrl('PUT', bucketName, objectName, expires, cb);
  }

  // return PostPolicy object
  newPostPolicy() {
    return new _postPolicy.PostPolicy();
  }

  // presignedPostPolicy can be used in situations where we want more control on the upload than what
  // presignedPutObject() provides. i.e Using presignedPostPolicy we will be able to put policy restrictions
  // on the object's `name` `bucket` `expiry` `Content-Type` `Content-Disposition` `metaData`
  presignedPostPolicy(postPolicy, cb) {
    if (this.anonymous) {
      throw new errors.AnonymousRequestError('Presigned POST policy cannot be generated for anonymous requests');
    }
    if (!(0, _helper.isObject)(postPolicy)) {
      throw new TypeError('postPolicy should be of type "object"');
    }
    if (!(0, _helper.isFunction)(cb)) {
      throw new TypeError('cb should be of type "function"');
    }
    this.getBucketRegion(postPolicy.formData.bucket, (e, region) => {
      if (e) {
        return cb(e);
      }
      var date = new Date();
      var dateStr = (0, _helper.makeDateLong)(date);
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
      postPolicy.policy.conditions.push(['eq', '$x-amz-credential', this.accessKey + '/' + (0, _helper.getScope)(region, date)]);
      postPolicy.formData['x-amz-credential'] = this.accessKey + '/' + (0, _helper.getScope)(region, date);
      if (this.sessionToken) {
        postPolicy.policy.conditions.push(['eq', '$x-amz-security-token', this.sessionToken]);
        postPolicy.formData['x-amz-security-token'] = this.sessionToken;
      }
      var policyBase64 = Buffer.from(JSON.stringify(postPolicy.policy)).toString('base64');
      postPolicy.formData.policy = policyBase64;
      var signature = (0, _signing.postPresignSignatureV4)(region, date, this.secretKey, policyBase64);
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isObject)(config)) {
      throw new TypeError('notification config should be of type "Object"');
    }
    if (!(0, _helper.isFunction)(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    var method = 'PUT';
    var query = 'notification';
    var builder = new _xml2js.Builder({
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
    this.setBucketNotification(bucketName, new _notification.NotificationConfig(), cb);
  }

  // Return the list of notification configurations stored
  // in the S3 provider
  getBucketNotification(bucketName, cb) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isFunction)(cb)) {
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
      (0, _helper.pipesetup)(response, transformer).on('data', result => bucketNotification = result).on('error', e => cb(e)).on('end', () => cb(null, bucketNotification));
    });
  }

  // Listens for bucket notifications. Returns an EventEmitter.
  listenBucketNotification(bucketName, prefix, suffix, events) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!(0, _helper.isString)(prefix)) {
      throw new TypeError('prefix must be of type string');
    }
    if (!(0, _helper.isString)(suffix)) {
      throw new TypeError('suffix must be of type string');
    }
    if (!Array.isArray(events)) {
      throw new TypeError('events must be of type Array');
    }
    let listener = new _notification.NotificationPoller(this, bucketName, prefix, suffix, events);
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
    const encoder = new _webEncoding.TextEncoder();
    const headers = {};
    const builder = new _xml2js.Builder({
      headless: true,
      renderOpts: {
        pretty: false
      }
    });
    let payload = builder.buildObject(taggingConfig);
    payload = Buffer.from(encoder.encode(payload));
    headers['Content-MD5'] = (0, _helper.toMd5)(payload);
    const requestOptions = {
      method,
      bucketName,
      query,
      headers
    };
    if (objectName) {
      requestOptions['objectName'] = objectName;
    }
    headers['Content-MD5'] = (0, _helper.toMd5)(payload);
    this.makeRequest(requestOptions, payload, [200], '', false, cb);
  }

  /** Set Tags on a Bucket
   * __Arguments__
   * bucketName _string_
   * tags _object_ of the form {'<tag-key-1>':'<tag-value-1>','<tag-key-2>':'<tag-value-2>'}
   * `cb(error)` _function_ - callback function with `err` as the error argument. `err` is null if the operation is successful.
   */
  setBucketTagging(bucketName, tags, cb) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isObject)(tags)) {
      throw new errors.InvalidArgumentError('tags should be of type "object"');
    }
    if (Object.keys(tags).length > 10) {
      throw new errors.InvalidArgumentError('maximum tags allowed is 10"');
    }
    if (!(0, _helper.isFunction)(cb)) {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidBucketNameError('Invalid object name: ' + objectName);
    }
    if ((0, _helper.isFunction)(putOpts)) {
      cb = putOpts;
      putOpts = {};
    }
    if (!(0, _helper.isObject)(tags)) {
      throw new errors.InvalidArgumentError('tags should be of type "object"');
    }
    if (Object.keys(tags).length > 10) {
      throw new errors.InvalidArgumentError('Maximum tags allowed is 10"');
    }
    if (!(0, _helper.isFunction)(cb)) {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isFunction)(cb)) {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidBucketNameError('Invalid object name: ' + objectName);
    }
    if ((0, _helper.isFunction)(removeOpts)) {
      cb = removeOpts;
      removeOpts = {};
    }
    if (removeOpts && Object.keys(removeOpts).length && !(0, _helper.isObject)(removeOpts)) {
      throw new errors.InvalidArgumentError('removeOpts should be of type "object"');
    }
    if (!(0, _helper.isFunction)(cb)) {
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
    const encoder = new _webEncoding.TextEncoder();
    const headers = {};
    const builder = new _xml2js.Builder({
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
    headers['Content-MD5'] = (0, _helper.toMd5)(payload);
    this.makeRequest(requestOptions, payload, [200], '', false, cb);
  }

  /** Remove lifecycle configuration of a bucket.
   * bucketName _string_
   * `cb(error)` _function_ - callback function with `err` as the error argument. `err` is null if the operation is successful.
   */
  removeBucketLifecycle(bucketName, cb) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (_lodash.isEmpty(lifeCycleConfig)) {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
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
      (0, _helper.pipesetup)(response, transformer).on('data', result => lifecycleConfig = result).on('error', e => cb(e)).on('end', () => cb(null, lifecycleConfig));
    });
  }
  getObjectRetention(bucketName, objectName, getOpts, cb) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isObject)(getOpts)) {
      throw new errors.InvalidArgumentError('callback should be of type "object"');
    } else if (getOpts.versionId && !(0, _helper.isString)(getOpts.versionId)) {
      throw new errors.InvalidArgumentError('VersionID should be of type "string"');
    }
    if (cb && !(0, _helper.isFunction)(cb)) {
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
      (0, _helper.pipesetup)(response, transformers.objectRetentionTransformer()).on('data', data => {
        retentionConfig = data;
      }).on('error', cb).on('end', () => {
        cb(null, retentionConfig);
      });
    });
  }
  setBucketEncryption(bucketName, encryptionConfig, cb) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if ((0, _helper.isFunction)(encryptionConfig)) {
      cb = encryptionConfig;
      encryptionConfig = null;
    }
    if (!_lodash.isEmpty(encryptionConfig) && encryptionConfig.Rule.length > 1) {
      throw new errors.InvalidArgumentError('Invalid Rule length. Only one rule is allowed.: ' + encryptionConfig.Rule);
    }
    if (cb && !(0, _helper.isFunction)(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    let encryptionObj = encryptionConfig;
    if (_lodash.isEmpty(encryptionConfig)) {
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
    let builder = new _xml2js.Builder({
      rootName: 'ServerSideEncryptionConfiguration',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    let payload = builder.buildObject(encryptionObj);
    const headers = {};
    headers['Content-MD5'] = (0, _helper.toMd5)(payload);
    this.makeRequest({
      method,
      bucketName,
      query,
      headers
    }, payload, [200], '', false, cb);
  }
  getBucketEncryption(bucketName, cb) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isFunction)(cb)) {
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
      (0, _helper.pipesetup)(response, transformers.bucketEncryptionTransformer()).on('data', data => {
        bucketEncConfig = data;
      }).on('error', cb).on('end', () => {
        cb(null, bucketEncConfig);
      });
    });
  }
  removeBucketEncryption(bucketName, cb) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isFunction)(cb)) {
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
      (0, _helper.pipesetup)(response, transformers.uploadPartTransformer()).on('data', data => {
        partCopyResult = data;
      }).on('error', cb).on('end', () => {
        let uploadPartCopyRes = {
          etag: (0, _helper.sanitizeETag)(partCopyResult.ETag),
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
    if (!(destObjConfig instanceof _helpers.CopyDestinationOptions)) {
      throw new errors.InvalidArgumentError('destConfig should of type CopyDestinationOptions ');
    }
    if (sourceFilesLength < 1 || sourceFilesLength > _helper.PART_CONSTRAINTS.MAX_PARTS_COUNT) {
      throw new errors.InvalidArgumentError(`"There must be as least one and up to ${_helper.PART_CONSTRAINTS.MAX_PARTS_COUNT} source objects.`);
    }
    if (!(0, _helper.isFunction)(cb)) {
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
      if (!_lodash.isEmpty(srcConfig.VersionID)) {
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
        if (srcCopySize < _helper.PART_CONSTRAINTS.ABS_MIN_PART_SIZE && index < sourceFilesLength - 1) {
          throw new errors.InvalidArgumentError(`CopySrcOptions ${index} is too small (${srcCopySize}) and it is not the last part.`);
        }

        // Is data to copy too large?
        totalSize += srcCopySize;
        if (totalSize > _helper.PART_CONSTRAINTS.MAX_MULTIPART_PUT_OBJECT_SIZE) {
          throw new errors.InvalidArgumentError(`Cannot compose an object of size ${totalSize} (> 5TiB)`);
        }

        // record source size
        srcObjectSizes[index] = srcCopySize;

        // calculate parts needed for current source
        totalParts += (0, _helper.partsRequired)(srcCopySize);
        // Do we need more parts than we are allowed?
        if (totalParts > _helper.PART_CONSTRAINTS.MAX_PARTS_COUNT) {
          throw new errors.InvalidArgumentError(`Your proposed compose object requires more than ${_helper.PART_CONSTRAINTS.MAX_PARTS_COUNT} parts`);
        }
        return resItemStat;
      });
      if (totalParts === 1 && totalSize <= _helper.PART_CONSTRAINTS.MAX_PART_SIZE || totalSize === 0) {
        return this.copyObject(sourceObjList[0], destObjConfig, cb); // use copyObjectV2
      }

      // preserve etag to avoid modification of object while copying.
      for (let i = 0; i < sourceFilesLength; i++) {
        sourceObjList[i].MatchETag = validatedStats[i].etag;
      }
      const splitPartSizeList = validatedStats.map((resItemStat, idx) => {
        const calSize = (0, _helper.calculateEvenSplits)(srcObjectSizes[idx], sourceObjList[idx]);
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
        _async.map(uploadList, me.uploadPartCopy.bind(me), (err, res) => {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!_lodash.isEmpty(selectOpts)) {
      if (!(0, _helper.isString)(selectOpts.expression)) {
        throw new TypeError('sqlExpression should be of type "string"');
      }
      if (!_lodash.isEmpty(selectOpts.inputSerialization)) {
        if (!(0, _helper.isObject)(selectOpts.inputSerialization)) {
          throw new TypeError('inputSerialization should be of type "object"');
        }
      } else {
        throw new TypeError('inputSerialization is required');
      }
      if (!_lodash.isEmpty(selectOpts.outputSerialization)) {
        if (!(0, _helper.isObject)(selectOpts.outputSerialization)) {
          throw new TypeError('outputSerialization should be of type "object"');
        }
      } else {
        throw new TypeError('outputSerialization is required');
      }
    } else {
      throw new TypeError('valid select configuration is required');
    }
    if (!(0, _helper.isFunction)(cb)) {
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
    const builder = new _xml2js.Builder({
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
      (0, _helper.pipesetup)(response, transformers.selectObjectContentTransformer()).on('data', data => {
        selectResult = (0, _xmlParsers.parseSelectObjectContentResponse)(data);
      }).on('error', cb).on('end', () => {
        cb(null, selectResult);
      });
    });
  }
}

// Promisify various public-facing APIs on the Client module.
exports.Client = Client;
Client.prototype.copyObject = (0, _promisify.promisify)(Client.prototype.copyObject);
Client.prototype.removeObjects = (0, _promisify.promisify)(Client.prototype.removeObjects);
Client.prototype.presignedUrl = (0, _promisify.promisify)(Client.prototype.presignedUrl);
Client.prototype.presignedGetObject = (0, _promisify.promisify)(Client.prototype.presignedGetObject);
Client.prototype.presignedPutObject = (0, _promisify.promisify)(Client.prototype.presignedPutObject);
Client.prototype.presignedPostPolicy = (0, _promisify.promisify)(Client.prototype.presignedPostPolicy);
Client.prototype.getBucketNotification = (0, _promisify.promisify)(Client.prototype.getBucketNotification);
Client.prototype.setBucketNotification = (0, _promisify.promisify)(Client.prototype.setBucketNotification);
Client.prototype.removeAllBucketNotification = (0, _promisify.promisify)(Client.prototype.removeAllBucketNotification);
Client.prototype.removeIncompleteUpload = (0, _promisify.promisify)(Client.prototype.removeIncompleteUpload);
Client.prototype.setBucketTagging = (0, _promisify.promisify)(Client.prototype.setBucketTagging);
Client.prototype.removeBucketTagging = (0, _promisify.promisify)(Client.prototype.removeBucketTagging);
Client.prototype.setObjectTagging = (0, _promisify.promisify)(Client.prototype.setObjectTagging);
Client.prototype.removeObjectTagging = (0, _promisify.promisify)(Client.prototype.removeObjectTagging);
Client.prototype.setBucketLifecycle = (0, _promisify.promisify)(Client.prototype.setBucketLifecycle);
Client.prototype.getBucketLifecycle = (0, _promisify.promisify)(Client.prototype.getBucketLifecycle);
Client.prototype.removeBucketLifecycle = (0, _promisify.promisify)(Client.prototype.removeBucketLifecycle);
Client.prototype.getObjectRetention = (0, _promisify.promisify)(Client.prototype.getObjectRetention);
Client.prototype.setBucketEncryption = (0, _promisify.promisify)(Client.prototype.setBucketEncryption);
Client.prototype.getBucketEncryption = (0, _promisify.promisify)(Client.prototype.getBucketEncryption);
Client.prototype.removeBucketEncryption = (0, _promisify.promisify)(Client.prototype.removeBucketEncryption);
Client.prototype.composeObject = (0, _promisify.promisify)(Client.prototype.composeObject);
Client.prototype.selectObjectContent = (0, _promisify.promisify)(Client.prototype.selectObjectContent);

// refactored API use promise internally
Client.prototype.makeBucket = (0, _callbackify.callbackify)(Client.prototype.makeBucket);
Client.prototype.bucketExists = (0, _callbackify.callbackify)(Client.prototype.bucketExists);
Client.prototype.removeBucket = (0, _callbackify.callbackify)(Client.prototype.removeBucket);
Client.prototype.listBuckets = (0, _callbackify.callbackify)(Client.prototype.listBuckets);
Client.prototype.getObject = (0, _callbackify.callbackify)(Client.prototype.getObject);
Client.prototype.fGetObject = (0, _callbackify.callbackify)(Client.prototype.fGetObject);
Client.prototype.getPartialObject = (0, _callbackify.callbackify)(Client.prototype.getPartialObject);
Client.prototype.statObject = (0, _callbackify.callbackify)(Client.prototype.statObject);
Client.prototype.putObjectRetention = (0, _callbackify.callbackify)(Client.prototype.putObjectRetention);
Client.prototype.putObject = (0, _callbackify.callbackify)(Client.prototype.putObject);
Client.prototype.fPutObject = (0, _callbackify.callbackify)(Client.prototype.fPutObject);
Client.prototype.removeObject = (0, _callbackify.callbackify)(Client.prototype.removeObject);
Client.prototype.removeBucketReplication = (0, _callbackify.callbackify)(Client.prototype.removeBucketReplication);
Client.prototype.setBucketReplication = (0, _callbackify.callbackify)(Client.prototype.setBucketReplication);
Client.prototype.getBucketReplication = (0, _callbackify.callbackify)(Client.prototype.getBucketReplication);
Client.prototype.getObjectLegalHold = (0, _callbackify.callbackify)(Client.prototype.getObjectLegalHold);
Client.prototype.setObjectLegalHold = (0, _callbackify.callbackify)(Client.prototype.setObjectLegalHold);
Client.prototype.getBucketTagging = (0, _callbackify.callbackify)(Client.prototype.getBucketTagging);
Client.prototype.getObjectTagging = (0, _callbackify.callbackify)(Client.prototype.getObjectTagging);
Client.prototype.setObjectLockConfig = (0, _callbackify.callbackify)(Client.prototype.setObjectLockConfig);
Client.prototype.getObjectLockConfig = (0, _callbackify.callbackify)(Client.prototype.getObjectLockConfig);
Client.prototype.getBucketPolicy = (0, _callbackify.callbackify)(Client.prototype.getBucketPolicy);
Client.prototype.setBucketPolicy = (0, _callbackify.callbackify)(Client.prototype.setBucketPolicy);
Client.prototype.getBucketVersioning = (0, _callbackify.callbackify)(Client.prototype.getBucketVersioning);
Client.prototype.setBucketVersioning = (0, _callbackify.callbackify)(Client.prototype.setBucketVersioning);
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJTdHJlYW0iLCJfaW50ZXJvcFJlcXVpcmVXaWxkY2FyZCIsInJlcXVpcmUiLCJfYXN5bmMiLCJfbG9kYXNoIiwicXVlcnlzdHJpbmciLCJfd2ViRW5jb2RpbmciLCJfeG1sMmpzIiwiZXJyb3JzIiwiT2JqZWN0Iiwia2V5cyIsImZvckVhY2giLCJrZXkiLCJwcm90b3R5cGUiLCJoYXNPd25Qcm9wZXJ0eSIsImNhbGwiLCJfZXhwb3J0TmFtZXMiLCJleHBvcnRzIiwiX2hlbHBlcnMiLCJfY2FsbGJhY2tpZnkiLCJfY2xpZW50IiwiX2NvcHlDb25kaXRpb25zIiwiQ29weUNvbmRpdGlvbnMiLCJfaGVscGVyIiwiX3Bvc3RQb2xpY3kiLCJQb3N0UG9saWN5IiwiX25vdGlmaWNhdGlvbiIsIl9wcm9taXNpZnkiLCJfc2lnbmluZyIsInRyYW5zZm9ybWVycyIsIl94bWxQYXJzZXJzIiwiX2dldFJlcXVpcmVXaWxkY2FyZENhY2hlIiwibm9kZUludGVyb3AiLCJXZWFrTWFwIiwiY2FjaGVCYWJlbEludGVyb3AiLCJjYWNoZU5vZGVJbnRlcm9wIiwib2JqIiwiX19lc01vZHVsZSIsImRlZmF1bHQiLCJjYWNoZSIsImhhcyIsImdldCIsIm5ld09iaiIsImhhc1Byb3BlcnR5RGVzY3JpcHRvciIsImRlZmluZVByb3BlcnR5IiwiZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yIiwiZGVzYyIsInNldCIsIkNsaWVudCIsIlR5cGVkQ2xpZW50Iiwic2V0QXBwSW5mbyIsImFwcE5hbWUiLCJhcHBWZXJzaW9uIiwiaXNTdHJpbmciLCJUeXBlRXJyb3IiLCJ0cmltIiwiSW52YWxpZEFyZ3VtZW50RXJyb3IiLCJ1c2VyQWdlbnQiLCJyZW1vdmVJbmNvbXBsZXRlVXBsb2FkIiwiYnVja2V0TmFtZSIsIm9iamVjdE5hbWUiLCJjYiIsImlzVmFsaWRCdWNrZXROYW1lIiwiSXNWYWxpZEJ1Y2tldE5hbWVFcnJvciIsImlzVmFsaWRPYmplY3ROYW1lIiwiSW52YWxpZE9iamVjdE5hbWVFcnJvciIsImlzRnVuY3Rpb24iLCJyZW1vdmVVcGxvYWRJZCIsImFzeW5jIiwiZHVyaW5nIiwiZmluZFVwbG9hZElkIiwidGhlbiIsInVwbG9hZElkIiwibWV0aG9kIiwicXVlcnkiLCJtYWtlUmVxdWVzdCIsImUiLCJjb3B5T2JqZWN0VjEiLCJhcmcxIiwiYXJnMiIsImFyZzMiLCJhcmc0IiwiYXJnNSIsInNyY09iamVjdCIsImNvbmRpdGlvbnMiLCJ1bmRlZmluZWQiLCJJbnZhbGlkQnVja2V0TmFtZUVycm9yIiwiSW52YWxpZFByZWZpeEVycm9yIiwiaGVhZGVycyIsInVyaVJlc291cmNlRXNjYXBlIiwibW9kaWZpZWQiLCJ1bm1vZGlmaWVkIiwibWF0Y2hFVGFnIiwibWF0Y2hFdGFnRXhjZXB0IiwibWF0Y2hFVGFnRXhjZXB0IiwicmVzcG9uc2UiLCJ0cmFuc2Zvcm1lciIsImdldENvcHlPYmplY3RUcmFuc2Zvcm1lciIsInBpcGVzZXR1cCIsIm9uIiwiZGF0YSIsImNvcHlPYmplY3RWMiIsInNvdXJjZUNvbmZpZyIsImRlc3RDb25maWciLCJDb3B5U291cmNlT3B0aW9ucyIsIkNvcHlEZXN0aW5hdGlvbk9wdGlvbnMiLCJ2YWxpZGF0ZSIsImFzc2lnbiIsImdldEhlYWRlcnMiLCJCdWNrZXQiLCJyZXNIZWFkZXJzIiwiY29weU9ialJlc3BvbnNlIiwiS2V5IiwiTGFzdE1vZGlmaWVkIiwiTWV0YURhdGEiLCJleHRyYWN0TWV0YWRhdGEiLCJWZXJzaW9uSWQiLCJnZXRWZXJzaW9uSWQiLCJTb3VyY2VWZXJzaW9uSWQiLCJnZXRTb3VyY2VWZXJzaW9uSWQiLCJFdGFnIiwic2FuaXRpemVFVGFnIiwiZXRhZyIsIlNpemUiLCJjb3B5T2JqZWN0IiwiYWxsQXJncyIsImFyZ3VtZW50cyIsImxpc3RPYmplY3RzUXVlcnkiLCJwcmVmaXgiLCJtYXJrZXIiLCJsaXN0UXVlcnlPcHRzIiwiRGVsaW1pdGVyIiwiTWF4S2V5cyIsIkluY2x1ZGVWZXJzaW9uIiwiaXNPYmplY3QiLCJpc051bWJlciIsInF1ZXJpZXMiLCJwdXNoIiwidXJpRXNjYXBlIiwic29ydCIsImxlbmd0aCIsImpvaW4iLCJnZXRMaXN0T2JqZWN0c1RyYW5zZm9ybWVyIiwiZW1pdCIsImxpc3RPYmplY3RzIiwicmVjdXJzaXZlIiwibGlzdE9wdHMiLCJpc1ZhbGlkUHJlZml4IiwiaXNCb29sZWFuIiwib2JqZWN0cyIsImVuZGVkIiwicmVhZFN0cmVhbSIsIlJlYWRhYmxlIiwib2JqZWN0TW9kZSIsIl9yZWFkIiwic2hpZnQiLCJyZXN1bHQiLCJpc1RydW5jYXRlZCIsIm5leHRNYXJrZXIiLCJ2ZXJzaW9uSWRNYXJrZXIiLCJsaXN0T2JqZWN0c1YyUXVlcnkiLCJjb250aW51YXRpb25Ub2tlbiIsImRlbGltaXRlciIsIm1heEtleXMiLCJzdGFydEFmdGVyIiwiZ2V0TGlzdE9iamVjdHNWMlRyYW5zZm9ybWVyIiwibGlzdE9iamVjdHNWMiIsIm5leHRDb250aW51YXRpb25Ub2tlbiIsInJlbW92ZU9iamVjdHMiLCJvYmplY3RzTGlzdCIsIkFycmF5IiwiaXNBcnJheSIsIm1heEVudHJpZXMiLCJyZWR1Y2UiLCJlbnRyeSIsImxpc3QiLCJsaXN0T2ZMaXN0IiwiZW5jb2RlciIsIlRleHRFbmNvZGVyIiwiYmF0Y2hSZXN1bHRzIiwiZWFjaFNlcmllcyIsImJhdGNoQ2IiLCJ2YWx1ZSIsIm5hbWUiLCJ2ZXJzaW9uSWQiLCJkZWxldGVPYmplY3RzIiwiRGVsZXRlIiwiUXVpZXQiLCJidWlsZGVyIiwieG1sMmpzIiwiQnVpbGRlciIsImhlYWRsZXNzIiwicGF5bG9hZCIsImJ1aWxkT2JqZWN0IiwiQnVmZmVyIiwiZnJvbSIsImVuY29kZSIsInRvTWQ1IiwicmVtb3ZlT2JqZWN0c1Jlc3VsdCIsInJlbW92ZU9iamVjdHNUcmFuc2Zvcm1lciIsIl8iLCJmbGF0dGVuIiwicHJlc2lnbmVkVXJsIiwiZXhwaXJlcyIsInJlcVBhcmFtcyIsInJlcXVlc3REYXRlIiwiYW5vbnltb3VzIiwiQW5vbnltb3VzUmVxdWVzdEVycm9yIiwiRGF0ZSIsImlzVmFsaWREYXRlIiwic3RyaW5naWZ5IiwiZ2V0QnVja2V0UmVnaW9uIiwicmVnaW9uIiwidXJsIiwicmVxT3B0aW9ucyIsImdldFJlcXVlc3RPcHRpb25zIiwiY2hlY2tBbmRSZWZyZXNoQ3JlZHMiLCJwcmVzaWduU2lnbmF0dXJlVjQiLCJhY2Nlc3NLZXkiLCJzZWNyZXRLZXkiLCJzZXNzaW9uVG9rZW4iLCJwZSIsInByZXNpZ25lZEdldE9iamVjdCIsInJlc3BIZWFkZXJzIiwidmFsaWRSZXNwSGVhZGVycyIsImhlYWRlciIsInByZXNpZ25lZFB1dE9iamVjdCIsIm5ld1Bvc3RQb2xpY3kiLCJwcmVzaWduZWRQb3N0UG9saWN5IiwicG9zdFBvbGljeSIsImZvcm1EYXRhIiwiYnVja2V0IiwiZGF0ZSIsImRhdGVTdHIiLCJtYWtlRGF0ZUxvbmciLCJwb2xpY3kiLCJleHBpcmF0aW9uIiwic2V0U2Vjb25kcyIsInNldEV4cGlyZXMiLCJnZXRTY29wZSIsInBvbGljeUJhc2U2NCIsIkpTT04iLCJ0b1N0cmluZyIsInNpZ25hdHVyZSIsInBvc3RQcmVzaWduU2lnbmF0dXJlVjQiLCJvcHRzIiwicG9ydFN0ciIsInBvcnQiLCJ1cmxTdHIiLCJwcm90b2NvbCIsImhvc3QiLCJwYXRoIiwicG9zdFVSTCIsInNldEJ1Y2tldE5vdGlmaWNhdGlvbiIsImNvbmZpZyIsInJvb3ROYW1lIiwicmVuZGVyT3B0cyIsInByZXR0eSIsInJlbW92ZUFsbEJ1Y2tldE5vdGlmaWNhdGlvbiIsIk5vdGlmaWNhdGlvbkNvbmZpZyIsImdldEJ1Y2tldE5vdGlmaWNhdGlvbiIsImdldEJ1Y2tldE5vdGlmaWNhdGlvblRyYW5zZm9ybWVyIiwiYnVja2V0Tm90aWZpY2F0aW9uIiwibGlzdGVuQnVja2V0Tm90aWZpY2F0aW9uIiwic3VmZml4IiwiZXZlbnRzIiwibGlzdGVuZXIiLCJOb3RpZmljYXRpb25Qb2xsZXIiLCJzdGFydCIsInNldFRhZ2dpbmciLCJ0YWdnaW5nUGFyYW1zIiwidGFncyIsInB1dE9wdHMiLCJ0YWdzTGlzdCIsImVudHJpZXMiLCJWYWx1ZSIsInRhZ2dpbmdDb25maWciLCJUYWdnaW5nIiwiVGFnU2V0IiwiVGFnIiwicmVxdWVzdE9wdGlvbnMiLCJzZXRCdWNrZXRUYWdnaW5nIiwic2V0T2JqZWN0VGFnZ2luZyIsInJlbW92ZVRhZ2dpbmciLCJyZW1vdmVPcHRzIiwicmVtb3ZlQnVja2V0VGFnZ2luZyIsInJlbW92ZU9iamVjdFRhZ2dpbmciLCJhcHBseUJ1Y2tldExpZmVjeWNsZSIsInBvbGljeUNvbmZpZyIsInJlbW92ZUJ1Y2tldExpZmVjeWNsZSIsInNldEJ1Y2tldExpZmVjeWNsZSIsImxpZmVDeWNsZUNvbmZpZyIsImlzRW1wdHkiLCJnZXRCdWNrZXRMaWZlY3ljbGUiLCJsaWZlY3ljbGVUcmFuc2Zvcm1lciIsImxpZmVjeWNsZUNvbmZpZyIsImdldE9iamVjdFJldGVudGlvbiIsImdldE9wdHMiLCJyZXRlbnRpb25Db25maWciLCJvYmplY3RSZXRlbnRpb25UcmFuc2Zvcm1lciIsInNldEJ1Y2tldEVuY3J5cHRpb24iLCJlbmNyeXB0aW9uQ29uZmlnIiwiUnVsZSIsImVuY3J5cHRpb25PYmoiLCJBcHBseVNlcnZlclNpZGVFbmNyeXB0aW9uQnlEZWZhdWx0IiwiU1NFQWxnb3JpdGhtIiwiZ2V0QnVja2V0RW5jcnlwdGlvbiIsImJ1Y2tldEVuY0NvbmZpZyIsImJ1Y2tldEVuY3J5cHRpb25UcmFuc2Zvcm1lciIsInJlbW92ZUJ1Y2tldEVuY3J5cHRpb24iLCJ1cGxvYWRQYXJ0Q29weSIsInBhcnRDb25maWciLCJ1cGxvYWRJRCIsInBhcnROdW1iZXIiLCJwYXJ0Q29weVJlc3VsdCIsInVwbG9hZFBhcnRUcmFuc2Zvcm1lciIsInVwbG9hZFBhcnRDb3B5UmVzIiwiRVRhZyIsInBhcnQiLCJjb21wb3NlT2JqZWN0IiwiZGVzdE9iakNvbmZpZyIsInNvdXJjZU9iakxpc3QiLCJtZSIsInNvdXJjZUZpbGVzTGVuZ3RoIiwiUEFSVF9DT05TVFJBSU5UUyIsIk1BWF9QQVJUU19DT1VOVCIsImkiLCJnZXRTdGF0T3B0aW9ucyIsInNyY0NvbmZpZyIsInN0YXRPcHRzIiwiVmVyc2lvbklEIiwic3JjT2JqZWN0U2l6ZXMiLCJ0b3RhbFNpemUiLCJ0b3RhbFBhcnRzIiwic291cmNlT2JqU3RhdHMiLCJtYXAiLCJzcmNJdGVtIiwic3RhdE9iamVjdCIsIlByb21pc2UiLCJhbGwiLCJzcmNPYmplY3RJbmZvcyIsInZhbGlkYXRlZFN0YXRzIiwicmVzSXRlbVN0YXQiLCJpbmRleCIsInNyY0NvcHlTaXplIiwic2l6ZSIsIk1hdGNoUmFuZ2UiLCJzcmNTdGFydCIsIlN0YXJ0Iiwic3JjRW5kIiwiRW5kIiwiQUJTX01JTl9QQVJUX1NJWkUiLCJNQVhfTVVMVElQQVJUX1BVVF9PQkpFQ1RfU0laRSIsInBhcnRzUmVxdWlyZWQiLCJNQVhfUEFSVF9TSVpFIiwiTWF0Y2hFVGFnIiwic3BsaXRQYXJ0U2l6ZUxpc3QiLCJpZHgiLCJjYWxTaXplIiwiY2FsY3VsYXRlRXZlblNwbGl0cyIsImdldFVwbG9hZFBhcnRDb25maWdMaXN0IiwidXBsb2FkUGFydENvbmZpZ0xpc3QiLCJzcGxpdFNpemUiLCJzcGxpdEluZGV4Iiwic3RhcnRJbmRleCIsInN0YXJ0SWR4IiwiZW5kSW5kZXgiLCJlbmRJZHgiLCJvYmpJbmZvIiwib2JqQ29uZmlnIiwicGFydEluZGV4IiwidG90YWxVcGxvYWRzIiwic3BsaXRTdGFydCIsInVwbGRDdHJJZHgiLCJzcGxpdEVuZCIsInNvdXJjZU9iaiIsInVwbG9hZFBhcnRDb25maWciLCJwZXJmb3JtVXBsb2FkUGFydHMiLCJ1cGxvYWRMaXN0IiwiYmluZCIsImVyciIsInJlcyIsImFib3J0TXVsdGlwYXJ0VXBsb2FkIiwicGFydHNEb25lIiwicGFydENvcHkiLCJjb21wbGV0ZU11bHRpcGFydFVwbG9hZCIsIm5ld1VwbG9hZEhlYWRlcnMiLCJpbml0aWF0ZU5ld011bHRpcGFydFVwbG9hZCIsImNhdGNoIiwiZXJyb3IiLCJzZWxlY3RPYmplY3RDb250ZW50Iiwic2VsZWN0T3B0cyIsImV4cHJlc3Npb24iLCJpbnB1dFNlcmlhbGl6YXRpb24iLCJvdXRwdXRTZXJpYWxpemF0aW9uIiwiRXhwcmVzc2lvbiIsIkV4cHJlc3Npb25UeXBlIiwiZXhwcmVzc2lvblR5cGUiLCJJbnB1dFNlcmlhbGl6YXRpb24iLCJPdXRwdXRTZXJpYWxpemF0aW9uIiwicmVxdWVzdFByb2dyZXNzIiwiUmVxdWVzdFByb2dyZXNzIiwic2NhblJhbmdlIiwiU2NhblJhbmdlIiwic2VsZWN0UmVzdWx0Iiwic2VsZWN0T2JqZWN0Q29udGVudFRyYW5zZm9ybWVyIiwicGFyc2VTZWxlY3RPYmplY3RDb250ZW50UmVzcG9uc2UiLCJwcm9taXNpZnkiLCJtYWtlQnVja2V0IiwiY2FsbGJhY2tpZnkiLCJidWNrZXRFeGlzdHMiLCJyZW1vdmVCdWNrZXQiLCJsaXN0QnVja2V0cyIsImdldE9iamVjdCIsImZHZXRPYmplY3QiLCJnZXRQYXJ0aWFsT2JqZWN0IiwicHV0T2JqZWN0UmV0ZW50aW9uIiwicHV0T2JqZWN0IiwiZlB1dE9iamVjdCIsInJlbW92ZU9iamVjdCIsInJlbW92ZUJ1Y2tldFJlcGxpY2F0aW9uIiwic2V0QnVja2V0UmVwbGljYXRpb24iLCJnZXRCdWNrZXRSZXBsaWNhdGlvbiIsImdldE9iamVjdExlZ2FsSG9sZCIsInNldE9iamVjdExlZ2FsSG9sZCIsImdldEJ1Y2tldFRhZ2dpbmciLCJnZXRPYmplY3RUYWdnaW5nIiwic2V0T2JqZWN0TG9ja0NvbmZpZyIsImdldE9iamVjdExvY2tDb25maWciLCJnZXRCdWNrZXRQb2xpY3kiLCJzZXRCdWNrZXRQb2xpY3kiLCJnZXRCdWNrZXRWZXJzaW9uaW5nIiwic2V0QnVja2V0VmVyc2lvbmluZyJdLCJzb3VyY2VzIjpbIm1pbmlvLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qXG4gKiBNaW5JTyBKYXZhc2NyaXB0IExpYnJhcnkgZm9yIEFtYXpvbiBTMyBDb21wYXRpYmxlIENsb3VkIFN0b3JhZ2UsIChDKSAyMDE1IE1pbklPLCBJbmMuXG4gKlxuICogTGljZW5zZWQgdW5kZXIgdGhlIEFwYWNoZSBMaWNlbnNlLCBWZXJzaW9uIDIuMCAodGhlIFwiTGljZW5zZVwiKTtcbiAqIHlvdSBtYXkgbm90IHVzZSB0aGlzIGZpbGUgZXhjZXB0IGluIGNvbXBsaWFuY2Ugd2l0aCB0aGUgTGljZW5zZS5cbiAqIFlvdSBtYXkgb2J0YWluIGEgY29weSBvZiB0aGUgTGljZW5zZSBhdFxuICpcbiAqICAgICBodHRwOi8vd3d3LmFwYWNoZS5vcmcvbGljZW5zZXMvTElDRU5TRS0yLjBcbiAqXG4gKiBVbmxlc3MgcmVxdWlyZWQgYnkgYXBwbGljYWJsZSBsYXcgb3IgYWdyZWVkIHRvIGluIHdyaXRpbmcsIHNvZnR3YXJlXG4gKiBkaXN0cmlidXRlZCB1bmRlciB0aGUgTGljZW5zZSBpcyBkaXN0cmlidXRlZCBvbiBhbiBcIkFTIElTXCIgQkFTSVMsXG4gKiBXSVRIT1VUIFdBUlJBTlRJRVMgT1IgQ09ORElUSU9OUyBPRiBBTlkgS0lORCwgZWl0aGVyIGV4cHJlc3Mgb3IgaW1wbGllZC5cbiAqIFNlZSB0aGUgTGljZW5zZSBmb3IgdGhlIHNwZWNpZmljIGxhbmd1YWdlIGdvdmVybmluZyBwZXJtaXNzaW9ucyBhbmRcbiAqIGxpbWl0YXRpb25zIHVuZGVyIHRoZSBMaWNlbnNlLlxuICovXG5cbmltcG9ydCAqIGFzIFN0cmVhbSBmcm9tICdub2RlOnN0cmVhbSdcblxuaW1wb3J0IGFzeW5jIGZyb20gJ2FzeW5jJ1xuaW1wb3J0IF8gZnJvbSAnbG9kYXNoJ1xuaW1wb3J0ICogYXMgcXVlcnlzdHJpbmcgZnJvbSAncXVlcnktc3RyaW5nJ1xuaW1wb3J0IHsgVGV4dEVuY29kZXIgfSBmcm9tICd3ZWItZW5jb2RpbmcnXG5pbXBvcnQgeG1sMmpzIGZyb20gJ3htbDJqcydcblxuaW1wb3J0ICogYXMgZXJyb3JzIGZyb20gJy4vZXJyb3JzLnRzJ1xuaW1wb3J0IHsgQ29weURlc3RpbmF0aW9uT3B0aW9ucywgQ29weVNvdXJjZU9wdGlvbnMgfSBmcm9tICcuL2hlbHBlcnMudHMnXG5pbXBvcnQgeyBjYWxsYmFja2lmeSB9IGZyb20gJy4vaW50ZXJuYWwvY2FsbGJhY2tpZnkuanMnXG5pbXBvcnQgeyBUeXBlZENsaWVudCB9IGZyb20gJy4vaW50ZXJuYWwvY2xpZW50LnRzJ1xuaW1wb3J0IHsgQ29weUNvbmRpdGlvbnMgfSBmcm9tICcuL2ludGVybmFsL2NvcHktY29uZGl0aW9ucy50cydcbmltcG9ydCB7XG4gIGNhbGN1bGF0ZUV2ZW5TcGxpdHMsXG4gIGV4dHJhY3RNZXRhZGF0YSxcbiAgZ2V0U2NvcGUsXG4gIGdldFNvdXJjZVZlcnNpb25JZCxcbiAgZ2V0VmVyc2lvbklkLFxuICBpc0Jvb2xlYW4sXG4gIGlzRnVuY3Rpb24sXG4gIGlzTnVtYmVyLFxuICBpc09iamVjdCxcbiAgaXNTdHJpbmcsXG4gIGlzVmFsaWRCdWNrZXROYW1lLFxuICBpc1ZhbGlkRGF0ZSxcbiAgaXNWYWxpZE9iamVjdE5hbWUsXG4gIGlzVmFsaWRQcmVmaXgsXG4gIG1ha2VEYXRlTG9uZyxcbiAgUEFSVF9DT05TVFJBSU5UUyxcbiAgcGFydHNSZXF1aXJlZCxcbiAgcGlwZXNldHVwLFxuICBzYW5pdGl6ZUVUYWcsXG4gIHRvTWQ1LFxuICB1cmlFc2NhcGUsXG4gIHVyaVJlc291cmNlRXNjYXBlLFxufSBmcm9tICcuL2ludGVybmFsL2hlbHBlci50cydcbmltcG9ydCB7IFBvc3RQb2xpY3kgfSBmcm9tICcuL2ludGVybmFsL3Bvc3QtcG9saWN5LnRzJ1xuaW1wb3J0IHsgTm90aWZpY2F0aW9uQ29uZmlnLCBOb3RpZmljYXRpb25Qb2xsZXIgfSBmcm9tICcuL25vdGlmaWNhdGlvbi50cydcbmltcG9ydCB7IHByb21pc2lmeSB9IGZyb20gJy4vcHJvbWlzaWZ5LmpzJ1xuaW1wb3J0IHsgcG9zdFByZXNpZ25TaWduYXR1cmVWNCwgcHJlc2lnblNpZ25hdHVyZVY0IH0gZnJvbSAnLi9zaWduaW5nLnRzJ1xuaW1wb3J0ICogYXMgdHJhbnNmb3JtZXJzIGZyb20gJy4vdHJhbnNmb3JtZXJzLmpzJ1xuaW1wb3J0IHsgcGFyc2VTZWxlY3RPYmplY3RDb250ZW50UmVzcG9uc2UgfSBmcm9tICcuL3htbC1wYXJzZXJzLmpzJ1xuXG5leHBvcnQgKiBmcm9tICcuL2Vycm9ycy50cydcbmV4cG9ydCAqIGZyb20gJy4vaGVscGVycy50cydcbmV4cG9ydCAqIGZyb20gJy4vbm90aWZpY2F0aW9uLnRzJ1xuZXhwb3J0IHsgQ29weUNvbmRpdGlvbnMsIFBvc3RQb2xpY3kgfVxuXG5leHBvcnQgY2xhc3MgQ2xpZW50IGV4dGVuZHMgVHlwZWRDbGllbnQge1xuICAvLyBTZXQgYXBwbGljYXRpb24gc3BlY2lmaWMgaW5mb3JtYXRpb24uXG4gIC8vXG4gIC8vIEdlbmVyYXRlcyBVc2VyLUFnZW50IGluIHRoZSBmb2xsb3dpbmcgc3R5bGUuXG4gIC8vXG4gIC8vICAgICAgIE1pbklPIChPUzsgQVJDSCkgTElCL1ZFUiBBUFAvVkVSXG4gIC8vXG4gIC8vIF9fQXJndW1lbnRzX19cbiAgLy8gKiBgYXBwTmFtZWAgX3N0cmluZ18gLSBBcHBsaWNhdGlvbiBuYW1lLlxuICAvLyAqIGBhcHBWZXJzaW9uYCBfc3RyaW5nXyAtIEFwcGxpY2F0aW9uIHZlcnNpb24uXG4gIHNldEFwcEluZm8oYXBwTmFtZSwgYXBwVmVyc2lvbikge1xuICAgIGlmICghaXNTdHJpbmcoYXBwTmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYEludmFsaWQgYXBwTmFtZTogJHthcHBOYW1lfWApXG4gICAgfVxuICAgIGlmIChhcHBOYW1lLnRyaW0oKSA9PT0gJycpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ0lucHV0IGFwcE5hbWUgY2Fubm90IGJlIGVtcHR5LicpXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcoYXBwVmVyc2lvbikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYEludmFsaWQgYXBwVmVyc2lvbjogJHthcHBWZXJzaW9ufWApXG4gICAgfVxuICAgIGlmIChhcHBWZXJzaW9uLnRyaW0oKSA9PT0gJycpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ0lucHV0IGFwcFZlcnNpb24gY2Fubm90IGJlIGVtcHR5LicpXG4gICAgfVxuICAgIHRoaXMudXNlckFnZW50ID0gYCR7dGhpcy51c2VyQWdlbnR9ICR7YXBwTmFtZX0vJHthcHBWZXJzaW9ufWBcbiAgfVxuXG4gIC8vIFJlbW92ZSB0aGUgcGFydGlhbGx5IHVwbG9hZGVkIG9iamVjdC5cbiAgLy9cbiAgLy8gX19Bcmd1bWVudHNfX1xuICAvLyAqIGBidWNrZXROYW1lYCBfc3RyaW5nXzogbmFtZSBvZiB0aGUgYnVja2V0XG4gIC8vICogYG9iamVjdE5hbWVgIF9zdHJpbmdfOiBuYW1lIG9mIHRoZSBvYmplY3RcbiAgLy8gKiBgY2FsbGJhY2soZXJyKWAgX2Z1bmN0aW9uXzogY2FsbGJhY2sgZnVuY3Rpb24gaXMgY2FsbGVkIHdpdGggbm9uIGBudWxsYCB2YWx1ZSBpbiBjYXNlIG9mIGVycm9yXG4gIHJlbW92ZUluY29tcGxldGVVcGxvYWQoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgY2IpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLklzVmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzRnVuY3Rpb24oY2IpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdjYWxsYmFjayBzaG91bGQgYmUgb2YgdHlwZSBcImZ1bmN0aW9uXCInKVxuICAgIH1cbiAgICB2YXIgcmVtb3ZlVXBsb2FkSWRcbiAgICBhc3luYy5kdXJpbmcoXG4gICAgICAoY2IpID0+IHtcbiAgICAgICAgdGhpcy5maW5kVXBsb2FkSWQoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSkudGhlbigodXBsb2FkSWQpID0+IHtcbiAgICAgICAgICByZW1vdmVVcGxvYWRJZCA9IHVwbG9hZElkXG4gICAgICAgICAgY2IobnVsbCwgdXBsb2FkSWQpXG4gICAgICAgIH0sIGNiKVxuICAgICAgfSxcbiAgICAgIChjYikgPT4ge1xuICAgICAgICB2YXIgbWV0aG9kID0gJ0RFTEVURSdcbiAgICAgICAgdmFyIHF1ZXJ5ID0gYHVwbG9hZElkPSR7cmVtb3ZlVXBsb2FkSWR9YFxuICAgICAgICB0aGlzLm1ha2VSZXF1ZXN0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSB9LCAnJywgWzIwNF0sICcnLCBmYWxzZSwgKGUpID0+IGNiKGUpKVxuICAgICAgfSxcbiAgICAgIGNiLFxuICAgIClcbiAgfVxuXG4gIC8vIENvcHkgdGhlIG9iamVjdC5cbiAgLy9cbiAgLy8gX19Bcmd1bWVudHNfX1xuICAvLyAqIGBidWNrZXROYW1lYCBfc3RyaW5nXzogbmFtZSBvZiB0aGUgYnVja2V0XG4gIC8vICogYG9iamVjdE5hbWVgIF9zdHJpbmdfOiBuYW1lIG9mIHRoZSBvYmplY3RcbiAgLy8gKiBgc3JjT2JqZWN0YCBfc3RyaW5nXzogcGF0aCBvZiB0aGUgc291cmNlIG9iamVjdCB0byBiZSBjb3BpZWRcbiAgLy8gKiBgY29uZGl0aW9uc2AgX0NvcHlDb25kaXRpb25zXzogY29weSBjb25kaXRpb25zIHRoYXQgbmVlZHMgdG8gYmUgc2F0aXNmaWVkIChvcHRpb25hbCwgZGVmYXVsdCBgbnVsbGApXG4gIC8vICogYGNhbGxiYWNrKGVyciwge2V0YWcsIGxhc3RNb2RpZmllZH0pYCBfZnVuY3Rpb25fOiBub24gbnVsbCBgZXJyYCBpbmRpY2F0ZXMgZXJyb3IsIGBldGFnYCBfc3RyaW5nXyBhbmQgYGxpc3RNb2RpZmVkYCBfRGF0ZV8gYXJlIHJlc3BlY3RpdmVseSB0aGUgZXRhZyBhbmQgdGhlIGxhc3QgbW9kaWZpZWQgZGF0ZSBvZiB0aGUgbmV3bHkgY29waWVkIG9iamVjdFxuICBjb3B5T2JqZWN0VjEoYXJnMSwgYXJnMiwgYXJnMywgYXJnNCwgYXJnNSkge1xuICAgIHZhciBidWNrZXROYW1lID0gYXJnMVxuICAgIHZhciBvYmplY3ROYW1lID0gYXJnMlxuICAgIHZhciBzcmNPYmplY3QgPSBhcmczXG4gICAgdmFyIGNvbmRpdGlvbnMsIGNiXG4gICAgaWYgKHR5cGVvZiBhcmc0ID09ICdmdW5jdGlvbicgJiYgYXJnNSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBjb25kaXRpb25zID0gbnVsbFxuICAgICAgY2IgPSBhcmc0XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbmRpdGlvbnMgPSBhcmc0XG4gICAgICBjYiA9IGFyZzVcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhzcmNPYmplY3QpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdzcmNPYmplY3Qgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmIChzcmNPYmplY3QgPT09ICcnKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRQcmVmaXhFcnJvcihgRW1wdHkgc291cmNlIHByZWZpeGApXG4gICAgfVxuXG4gICAgaWYgKGNvbmRpdGlvbnMgIT09IG51bGwgJiYgIShjb25kaXRpb25zIGluc3RhbmNlb2YgQ29weUNvbmRpdGlvbnMpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdjb25kaXRpb25zIHNob3VsZCBiZSBvZiB0eXBlIFwiQ29weUNvbmRpdGlvbnNcIicpXG4gICAgfVxuXG4gICAgdmFyIGhlYWRlcnMgPSB7fVxuICAgIGhlYWRlcnNbJ3gtYW16LWNvcHktc291cmNlJ10gPSB1cmlSZXNvdXJjZUVzY2FwZShzcmNPYmplY3QpXG5cbiAgICBpZiAoY29uZGl0aW9ucyAhPT0gbnVsbCkge1xuICAgICAgaWYgKGNvbmRpdGlvbnMubW9kaWZpZWQgIT09ICcnKSB7XG4gICAgICAgIGhlYWRlcnNbJ3gtYW16LWNvcHktc291cmNlLWlmLW1vZGlmaWVkLXNpbmNlJ10gPSBjb25kaXRpb25zLm1vZGlmaWVkXG4gICAgICB9XG4gICAgICBpZiAoY29uZGl0aW9ucy51bm1vZGlmaWVkICE9PSAnJykge1xuICAgICAgICBoZWFkZXJzWyd4LWFtei1jb3B5LXNvdXJjZS1pZi11bm1vZGlmaWVkLXNpbmNlJ10gPSBjb25kaXRpb25zLnVubW9kaWZpZWRcbiAgICAgIH1cbiAgICAgIGlmIChjb25kaXRpb25zLm1hdGNoRVRhZyAhPT0gJycpIHtcbiAgICAgICAgaGVhZGVyc1sneC1hbXotY29weS1zb3VyY2UtaWYtbWF0Y2gnXSA9IGNvbmRpdGlvbnMubWF0Y2hFVGFnXG4gICAgICB9XG4gICAgICBpZiAoY29uZGl0aW9ucy5tYXRjaEV0YWdFeGNlcHQgIT09ICcnKSB7XG4gICAgICAgIGhlYWRlcnNbJ3gtYW16LWNvcHktc291cmNlLWlmLW5vbmUtbWF0Y2gnXSA9IGNvbmRpdGlvbnMubWF0Y2hFVGFnRXhjZXB0XG4gICAgICB9XG4gICAgfVxuXG4gICAgdmFyIG1ldGhvZCA9ICdQVVQnXG4gICAgdGhpcy5tYWtlUmVxdWVzdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgaGVhZGVycyB9LCAnJywgWzIwMF0sICcnLCB0cnVlLCAoZSwgcmVzcG9uc2UpID0+IHtcbiAgICAgIGlmIChlKSB7XG4gICAgICAgIHJldHVybiBjYihlKVxuICAgICAgfVxuICAgICAgdmFyIHRyYW5zZm9ybWVyID0gdHJhbnNmb3JtZXJzLmdldENvcHlPYmplY3RUcmFuc2Zvcm1lcigpXG4gICAgICBwaXBlc2V0dXAocmVzcG9uc2UsIHRyYW5zZm9ybWVyKVxuICAgICAgICAub24oJ2Vycm9yJywgKGUpID0+IGNiKGUpKVxuICAgICAgICAub24oJ2RhdGEnLCAoZGF0YSkgPT4gY2IobnVsbCwgZGF0YSkpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBJbnRlcm5hbCBNZXRob2QgdG8gcGVyZm9ybSBjb3B5IG9mIGFuIG9iamVjdC5cbiAgICogQHBhcmFtIHNvdXJjZUNvbmZpZyBfX29iamVjdF9fICAgaW5zdGFuY2Ugb2YgQ29weVNvdXJjZU9wdGlvbnMgQGxpbmsgLi9oZWxwZXJzL0NvcHlTb3VyY2VPcHRpb25zXG4gICAqIEBwYXJhbSBkZXN0Q29uZmlnICBfX29iamVjdF9fICAgaW5zdGFuY2Ugb2YgQ29weURlc3RpbmF0aW9uT3B0aW9ucyBAbGluayAuL2hlbHBlcnMvQ29weURlc3RpbmF0aW9uT3B0aW9uc1xuICAgKiBAcGFyYW0gY2IgX19mdW5jdGlvbl9fIGNhbGxlZCB3aXRoIG51bGwgaWYgdGhlcmUgaXMgYW4gZXJyb3JcbiAgICogQHJldHVybnMgUHJvbWlzZSBpZiBubyBjYWxsYWNrIGlzIHBhc3NlZC5cbiAgICovXG4gIGNvcHlPYmplY3RWMihzb3VyY2VDb25maWcsIGRlc3RDb25maWcsIGNiKSB7XG4gICAgaWYgKCEoc291cmNlQ29uZmlnIGluc3RhbmNlb2YgQ29weVNvdXJjZU9wdGlvbnMpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdzb3VyY2VDb25maWcgc2hvdWxkIG9mIHR5cGUgQ29weVNvdXJjZU9wdGlvbnMgJylcbiAgICB9XG4gICAgaWYgKCEoZGVzdENvbmZpZyBpbnN0YW5jZW9mIENvcHlEZXN0aW5hdGlvbk9wdGlvbnMpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdkZXN0Q29uZmlnIHNob3VsZCBvZiB0eXBlIENvcHlEZXN0aW5hdGlvbk9wdGlvbnMgJylcbiAgICB9XG4gICAgaWYgKCFkZXN0Q29uZmlnLnZhbGlkYXRlKCkpIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cbiAgICBpZiAoIWRlc3RDb25maWcudmFsaWRhdGUoKSkge1xuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuICAgIGlmICghaXNGdW5jdGlvbihjYikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2NhbGxiYWNrIHNob3VsZCBiZSBvZiB0eXBlIFwiZnVuY3Rpb25cIicpXG4gICAgfVxuXG4gICAgY29uc3QgaGVhZGVycyA9IE9iamVjdC5hc3NpZ24oe30sIHNvdXJjZUNvbmZpZy5nZXRIZWFkZXJzKCksIGRlc3RDb25maWcuZ2V0SGVhZGVycygpKVxuXG4gICAgY29uc3QgYnVja2V0TmFtZSA9IGRlc3RDb25maWcuQnVja2V0XG4gICAgY29uc3Qgb2JqZWN0TmFtZSA9IGRlc3RDb25maWcuT2JqZWN0XG5cbiAgICBjb25zdCBtZXRob2QgPSAnUFVUJ1xuICAgIHRoaXMubWFrZVJlcXVlc3QoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGhlYWRlcnMgfSwgJycsIFsyMDBdLCAnJywgdHJ1ZSwgKGUsIHJlc3BvbnNlKSA9PiB7XG4gICAgICBpZiAoZSkge1xuICAgICAgICByZXR1cm4gY2IoZSlcbiAgICAgIH1cbiAgICAgIGNvbnN0IHRyYW5zZm9ybWVyID0gdHJhbnNmb3JtZXJzLmdldENvcHlPYmplY3RUcmFuc2Zvcm1lcigpXG4gICAgICBwaXBlc2V0dXAocmVzcG9uc2UsIHRyYW5zZm9ybWVyKVxuICAgICAgICAub24oJ2Vycm9yJywgKGUpID0+IGNiKGUpKVxuICAgICAgICAub24oJ2RhdGEnLCAoZGF0YSkgPT4ge1xuICAgICAgICAgIGNvbnN0IHJlc0hlYWRlcnMgPSByZXNwb25zZS5oZWFkZXJzXG5cbiAgICAgICAgICBjb25zdCBjb3B5T2JqUmVzcG9uc2UgPSB7XG4gICAgICAgICAgICBCdWNrZXQ6IGRlc3RDb25maWcuQnVja2V0LFxuICAgICAgICAgICAgS2V5OiBkZXN0Q29uZmlnLk9iamVjdCxcbiAgICAgICAgICAgIExhc3RNb2RpZmllZDogZGF0YS5MYXN0TW9kaWZpZWQsXG4gICAgICAgICAgICBNZXRhRGF0YTogZXh0cmFjdE1ldGFkYXRhKHJlc0hlYWRlcnMpLFxuICAgICAgICAgICAgVmVyc2lvbklkOiBnZXRWZXJzaW9uSWQocmVzSGVhZGVycyksXG4gICAgICAgICAgICBTb3VyY2VWZXJzaW9uSWQ6IGdldFNvdXJjZVZlcnNpb25JZChyZXNIZWFkZXJzKSxcbiAgICAgICAgICAgIEV0YWc6IHNhbml0aXplRVRhZyhyZXNIZWFkZXJzLmV0YWcpLFxuICAgICAgICAgICAgU2l6ZTogK3Jlc0hlYWRlcnNbJ2NvbnRlbnQtbGVuZ3RoJ10sXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcmV0dXJuIGNiKG51bGwsIGNvcHlPYmpSZXNwb25zZSlcbiAgICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLy8gQmFja3dhcmQgY29tcGF0aWJpbGl0eSBmb3IgQ29weSBPYmplY3QgQVBJLlxuICBjb3B5T2JqZWN0KC4uLmFsbEFyZ3MpIHtcbiAgICBpZiAoYWxsQXJnc1swXSBpbnN0YW5jZW9mIENvcHlTb3VyY2VPcHRpb25zICYmIGFsbEFyZ3NbMV0gaW5zdGFuY2VvZiBDb3B5RGVzdGluYXRpb25PcHRpb25zKSB7XG4gICAgICByZXR1cm4gdGhpcy5jb3B5T2JqZWN0VjIoLi4uYXJndW1lbnRzKVxuICAgIH1cbiAgICByZXR1cm4gdGhpcy5jb3B5T2JqZWN0VjEoLi4uYXJndW1lbnRzKVxuICB9XG5cbiAgLy8gbGlzdCBhIGJhdGNoIG9mIG9iamVjdHNcbiAgbGlzdE9iamVjdHNRdWVyeShidWNrZXROYW1lLCBwcmVmaXgsIG1hcmtlciwgbGlzdFF1ZXJ5T3B0cyA9IHt9KSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhwcmVmaXgpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdwcmVmaXggc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcobWFya2VyKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbWFya2VyIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBsZXQgeyBEZWxpbWl0ZXIsIE1heEtleXMsIEluY2x1ZGVWZXJzaW9uIH0gPSBsaXN0UXVlcnlPcHRzXG5cbiAgICBpZiAoIWlzT2JqZWN0KGxpc3RRdWVyeU9wdHMpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdsaXN0UXVlcnlPcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cblxuICAgIGlmICghaXNTdHJpbmcoRGVsaW1pdGVyKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignRGVsaW1pdGVyIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoIWlzTnVtYmVyKE1heEtleXMpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdNYXhLZXlzIHNob3VsZCBiZSBvZiB0eXBlIFwibnVtYmVyXCInKVxuICAgIH1cblxuICAgIGNvbnN0IHF1ZXJpZXMgPSBbXVxuICAgIC8vIGVzY2FwZSBldmVyeSB2YWx1ZSBpbiBxdWVyeSBzdHJpbmcsIGV4Y2VwdCBtYXhLZXlzXG4gICAgcXVlcmllcy5wdXNoKGBwcmVmaXg9JHt1cmlFc2NhcGUocHJlZml4KX1gKVxuICAgIHF1ZXJpZXMucHVzaChgZGVsaW1pdGVyPSR7dXJpRXNjYXBlKERlbGltaXRlcil9YClcbiAgICBxdWVyaWVzLnB1c2goYGVuY29kaW5nLXR5cGU9dXJsYClcblxuICAgIGlmIChJbmNsdWRlVmVyc2lvbikge1xuICAgICAgcXVlcmllcy5wdXNoKGB2ZXJzaW9uc2ApXG4gICAgfVxuXG4gICAgaWYgKG1hcmtlcikge1xuICAgICAgbWFya2VyID0gdXJpRXNjYXBlKG1hcmtlcilcbiAgICAgIGlmIChJbmNsdWRlVmVyc2lvbikge1xuICAgICAgICBxdWVyaWVzLnB1c2goYGtleS1tYXJrZXI9JHttYXJrZXJ9YClcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHF1ZXJpZXMucHVzaChgbWFya2VyPSR7bWFya2VyfWApXG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gbm8gbmVlZCB0byBlc2NhcGUgbWF4S2V5c1xuICAgIGlmIChNYXhLZXlzKSB7XG4gICAgICBpZiAoTWF4S2V5cyA+PSAxMDAwKSB7XG4gICAgICAgIE1heEtleXMgPSAxMDAwXG4gICAgICB9XG4gICAgICBxdWVyaWVzLnB1c2goYG1heC1rZXlzPSR7TWF4S2V5c31gKVxuICAgIH1cbiAgICBxdWVyaWVzLnNvcnQoKVxuICAgIHZhciBxdWVyeSA9ICcnXG4gICAgaWYgKHF1ZXJpZXMubGVuZ3RoID4gMCkge1xuICAgICAgcXVlcnkgPSBgJHtxdWVyaWVzLmpvaW4oJyYnKX1gXG4gICAgfVxuXG4gICAgdmFyIG1ldGhvZCA9ICdHRVQnXG4gICAgdmFyIHRyYW5zZm9ybWVyID0gdHJhbnNmb3JtZXJzLmdldExpc3RPYmplY3RzVHJhbnNmb3JtZXIoKVxuICAgIHRoaXMubWFrZVJlcXVlc3QoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0sICcnLCBbMjAwXSwgJycsIHRydWUsIChlLCByZXNwb25zZSkgPT4ge1xuICAgICAgaWYgKGUpIHtcbiAgICAgICAgcmV0dXJuIHRyYW5zZm9ybWVyLmVtaXQoJ2Vycm9yJywgZSlcbiAgICAgIH1cbiAgICAgIHBpcGVzZXR1cChyZXNwb25zZSwgdHJhbnNmb3JtZXIpXG4gICAgfSlcbiAgICByZXR1cm4gdHJhbnNmb3JtZXJcbiAgfVxuXG4gIC8vIExpc3QgdGhlIG9iamVjdHMgaW4gdGhlIGJ1Y2tldC5cbiAgLy9cbiAgLy8gX19Bcmd1bWVudHNfX1xuICAvLyAqIGBidWNrZXROYW1lYCBfc3RyaW5nXzogbmFtZSBvZiB0aGUgYnVja2V0XG4gIC8vICogYHByZWZpeGAgX3N0cmluZ186IHRoZSBwcmVmaXggb2YgdGhlIG9iamVjdHMgdGhhdCBzaG91bGQgYmUgbGlzdGVkIChvcHRpb25hbCwgZGVmYXVsdCBgJydgKVxuICAvLyAqIGByZWN1cnNpdmVgIF9ib29sXzogYHRydWVgIGluZGljYXRlcyByZWN1cnNpdmUgc3R5bGUgbGlzdGluZyBhbmQgYGZhbHNlYCBpbmRpY2F0ZXMgZGlyZWN0b3J5IHN0eWxlIGxpc3RpbmcgZGVsaW1pdGVkIGJ5ICcvJy4gKG9wdGlvbmFsLCBkZWZhdWx0IGBmYWxzZWApXG4gIC8vICogYGxpc3RPcHRzIF9vYmplY3RfOiBxdWVyeSBwYXJhbXMgdG8gbGlzdCBvYmplY3Qgd2l0aCBiZWxvdyBrZXlzXG4gIC8vICogICAgbGlzdE9wdHMuTWF4S2V5cyBfaW50XyBtYXhpbXVtIG51bWJlciBvZiBrZXlzIHRvIHJldHVyblxuICAvLyAqICAgIGxpc3RPcHRzLkluY2x1ZGVWZXJzaW9uICBfYm9vbF8gdHJ1ZXxmYWxzZSB0byBpbmNsdWRlIHZlcnNpb25zLlxuICAvLyBfX1JldHVybiBWYWx1ZV9fXG4gIC8vICogYHN0cmVhbWAgX1N0cmVhbV86IHN0cmVhbSBlbWl0dGluZyB0aGUgb2JqZWN0cyBpbiB0aGUgYnVja2V0LCB0aGUgb2JqZWN0IGlzIG9mIHRoZSBmb3JtYXQ6XG4gIC8vICogYG9iai5uYW1lYCBfc3RyaW5nXzogbmFtZSBvZiB0aGUgb2JqZWN0XG4gIC8vICogYG9iai5wcmVmaXhgIF9zdHJpbmdfOiBuYW1lIG9mIHRoZSBvYmplY3QgcHJlZml4XG4gIC8vICogYG9iai5zaXplYCBfbnVtYmVyXzogc2l6ZSBvZiB0aGUgb2JqZWN0XG4gIC8vICogYG9iai5ldGFnYCBfc3RyaW5nXzogZXRhZyBvZiB0aGUgb2JqZWN0XG4gIC8vICogYG9iai5sYXN0TW9kaWZpZWRgIF9EYXRlXzogbW9kaWZpZWQgdGltZSBzdGFtcFxuICAvLyAqIGBvYmouaXNEZWxldGVNYXJrZXJgIF9ib29sZWFuXzogdHJ1ZSBpZiBpdCBpcyBhIGRlbGV0ZSBtYXJrZXJcbiAgLy8gKiBgb2JqLnZlcnNpb25JZGAgX3N0cmluZ186IHZlcnNpb25JZCBvZiB0aGUgb2JqZWN0XG4gIGxpc3RPYmplY3RzKGJ1Y2tldE5hbWUsIHByZWZpeCwgcmVjdXJzaXZlLCBsaXN0T3B0cyA9IHt9KSB7XG4gICAgaWYgKHByZWZpeCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBwcmVmaXggPSAnJ1xuICAgIH1cbiAgICBpZiAocmVjdXJzaXZlID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHJlY3Vyc2l2ZSA9IGZhbHNlXG4gICAgfVxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZFByZWZpeChwcmVmaXgpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRQcmVmaXhFcnJvcihgSW52YWxpZCBwcmVmaXggOiAke3ByZWZpeH1gKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHByZWZpeCkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3ByZWZpeCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKCFpc0Jvb2xlYW4ocmVjdXJzaXZlKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVjdXJzaXZlIHNob3VsZCBiZSBvZiB0eXBlIFwiYm9vbGVhblwiJylcbiAgICB9XG4gICAgaWYgKCFpc09iamVjdChsaXN0T3B0cykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2xpc3RPcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cbiAgICB2YXIgbWFya2VyID0gJydcbiAgICBjb25zdCBsaXN0UXVlcnlPcHRzID0ge1xuICAgICAgRGVsaW1pdGVyOiByZWN1cnNpdmUgPyAnJyA6ICcvJywgLy8gaWYgcmVjdXJzaXZlIGlzIGZhbHNlIHNldCBkZWxpbWl0ZXIgdG8gJy8nXG4gICAgICBNYXhLZXlzOiAxMDAwLFxuICAgICAgSW5jbHVkZVZlcnNpb246IGxpc3RPcHRzLkluY2x1ZGVWZXJzaW9uLFxuICAgIH1cbiAgICB2YXIgb2JqZWN0cyA9IFtdXG4gICAgdmFyIGVuZGVkID0gZmFsc2VcbiAgICB2YXIgcmVhZFN0cmVhbSA9IFN0cmVhbS5SZWFkYWJsZSh7IG9iamVjdE1vZGU6IHRydWUgfSlcbiAgICByZWFkU3RyZWFtLl9yZWFkID0gKCkgPT4ge1xuICAgICAgLy8gcHVzaCBvbmUgb2JqZWN0IHBlciBfcmVhZCgpXG4gICAgICBpZiAob2JqZWN0cy5sZW5ndGgpIHtcbiAgICAgICAgcmVhZFN0cmVhbS5wdXNoKG9iamVjdHMuc2hpZnQoKSlcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG4gICAgICBpZiAoZW5kZWQpIHtcbiAgICAgICAgcmV0dXJuIHJlYWRTdHJlYW0ucHVzaChudWxsKVxuICAgICAgfVxuICAgICAgLy8gaWYgdGhlcmUgYXJlIG5vIG9iamVjdHMgdG8gcHVzaCBkbyBxdWVyeSBmb3IgdGhlIG5leHQgYmF0Y2ggb2Ygb2JqZWN0c1xuICAgICAgdGhpcy5saXN0T2JqZWN0c1F1ZXJ5KGJ1Y2tldE5hbWUsIHByZWZpeCwgbWFya2VyLCBsaXN0UXVlcnlPcHRzKVxuICAgICAgICAub24oJ2Vycm9yJywgKGUpID0+IHJlYWRTdHJlYW0uZW1pdCgnZXJyb3InLCBlKSlcbiAgICAgICAgLm9uKCdkYXRhJywgKHJlc3VsdCkgPT4ge1xuICAgICAgICAgIGlmIChyZXN1bHQuaXNUcnVuY2F0ZWQpIHtcbiAgICAgICAgICAgIG1hcmtlciA9IHJlc3VsdC5uZXh0TWFya2VyIHx8IHJlc3VsdC52ZXJzaW9uSWRNYXJrZXJcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZW5kZWQgPSB0cnVlXG4gICAgICAgICAgfVxuICAgICAgICAgIG9iamVjdHMgPSByZXN1bHQub2JqZWN0c1xuICAgICAgICAgIHJlYWRTdHJlYW0uX3JlYWQoKVxuICAgICAgICB9KVxuICAgIH1cbiAgICByZXR1cm4gcmVhZFN0cmVhbVxuICB9XG5cbiAgLy8gbGlzdE9iamVjdHNWMlF1ZXJ5IC0gKExpc3QgT2JqZWN0cyBWMikgLSBMaXN0IHNvbWUgb3IgYWxsICh1cCB0byAxMDAwKSBvZiB0aGUgb2JqZWN0cyBpbiBhIGJ1Y2tldC5cbiAgLy9cbiAgLy8gWW91IGNhbiB1c2UgdGhlIHJlcXVlc3QgcGFyYW1ldGVycyBhcyBzZWxlY3Rpb24gY3JpdGVyaWEgdG8gcmV0dXJuIGEgc3Vic2V0IG9mIHRoZSBvYmplY3RzIGluIGEgYnVja2V0LlxuICAvLyByZXF1ZXN0IHBhcmFtZXRlcnMgOi1cbiAgLy8gKiBgYnVja2V0TmFtZWAgX3N0cmluZ186IG5hbWUgb2YgdGhlIGJ1Y2tldFxuICAvLyAqIGBwcmVmaXhgIF9zdHJpbmdfOiBMaW1pdHMgdGhlIHJlc3BvbnNlIHRvIGtleXMgdGhhdCBiZWdpbiB3aXRoIHRoZSBzcGVjaWZpZWQgcHJlZml4LlxuICAvLyAqIGBjb250aW51YXRpb24tdG9rZW5gIF9zdHJpbmdfOiBVc2VkIHRvIGNvbnRpbnVlIGl0ZXJhdGluZyBvdmVyIGEgc2V0IG9mIG9iamVjdHMuXG4gIC8vICogYGRlbGltaXRlcmAgX3N0cmluZ186IEEgZGVsaW1pdGVyIGlzIGEgY2hhcmFjdGVyIHlvdSB1c2UgdG8gZ3JvdXAga2V5cy5cbiAgLy8gKiBgbWF4LWtleXNgIF9udW1iZXJfOiBTZXRzIHRoZSBtYXhpbXVtIG51bWJlciBvZiBrZXlzIHJldHVybmVkIGluIHRoZSByZXNwb25zZSBib2R5LlxuICAvLyAqIGBzdGFydC1hZnRlcmAgX3N0cmluZ186IFNwZWNpZmllcyB0aGUga2V5IHRvIHN0YXJ0IGFmdGVyIHdoZW4gbGlzdGluZyBvYmplY3RzIGluIGEgYnVja2V0LlxuICBsaXN0T2JqZWN0c1YyUXVlcnkoYnVja2V0TmFtZSwgcHJlZml4LCBjb250aW51YXRpb25Ub2tlbiwgZGVsaW1pdGVyLCBtYXhLZXlzLCBzdGFydEFmdGVyKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhwcmVmaXgpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdwcmVmaXggc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcoY29udGludWF0aW9uVG9rZW4pKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdjb250aW51YXRpb25Ub2tlbiBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhkZWxpbWl0ZXIpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdkZWxpbWl0ZXIgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmICghaXNOdW1iZXIobWF4S2V5cykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ21heEtleXMgc2hvdWxkIGJlIG9mIHR5cGUgXCJudW1iZXJcIicpXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcoc3RhcnRBZnRlcikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3N0YXJ0QWZ0ZXIgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIHZhciBxdWVyaWVzID0gW11cblxuICAgIC8vIENhbGwgZm9yIGxpc3Rpbmcgb2JqZWN0cyB2MiBBUElcbiAgICBxdWVyaWVzLnB1c2goYGxpc3QtdHlwZT0yYClcbiAgICBxdWVyaWVzLnB1c2goYGVuY29kaW5nLXR5cGU9dXJsYClcblxuICAgIC8vIGVzY2FwZSBldmVyeSB2YWx1ZSBpbiBxdWVyeSBzdHJpbmcsIGV4Y2VwdCBtYXhLZXlzXG4gICAgcXVlcmllcy5wdXNoKGBwcmVmaXg9JHt1cmlFc2NhcGUocHJlZml4KX1gKVxuICAgIHF1ZXJpZXMucHVzaChgZGVsaW1pdGVyPSR7dXJpRXNjYXBlKGRlbGltaXRlcil9YClcblxuICAgIGlmIChjb250aW51YXRpb25Ub2tlbikge1xuICAgICAgY29udGludWF0aW9uVG9rZW4gPSB1cmlFc2NhcGUoY29udGludWF0aW9uVG9rZW4pXG4gICAgICBxdWVyaWVzLnB1c2goYGNvbnRpbnVhdGlvbi10b2tlbj0ke2NvbnRpbnVhdGlvblRva2VufWApXG4gICAgfVxuICAgIC8vIFNldCBzdGFydC1hZnRlclxuICAgIGlmIChzdGFydEFmdGVyKSB7XG4gICAgICBzdGFydEFmdGVyID0gdXJpRXNjYXBlKHN0YXJ0QWZ0ZXIpXG4gICAgICBxdWVyaWVzLnB1c2goYHN0YXJ0LWFmdGVyPSR7c3RhcnRBZnRlcn1gKVxuICAgIH1cbiAgICAvLyBubyBuZWVkIHRvIGVzY2FwZSBtYXhLZXlzXG4gICAgaWYgKG1heEtleXMpIHtcbiAgICAgIGlmIChtYXhLZXlzID49IDEwMDApIHtcbiAgICAgICAgbWF4S2V5cyA9IDEwMDBcbiAgICAgIH1cbiAgICAgIHF1ZXJpZXMucHVzaChgbWF4LWtleXM9JHttYXhLZXlzfWApXG4gICAgfVxuICAgIHF1ZXJpZXMuc29ydCgpXG4gICAgdmFyIHF1ZXJ5ID0gJydcbiAgICBpZiAocXVlcmllcy5sZW5ndGggPiAwKSB7XG4gICAgICBxdWVyeSA9IGAke3F1ZXJpZXMuam9pbignJicpfWBcbiAgICB9XG4gICAgdmFyIG1ldGhvZCA9ICdHRVQnXG4gICAgdmFyIHRyYW5zZm9ybWVyID0gdHJhbnNmb3JtZXJzLmdldExpc3RPYmplY3RzVjJUcmFuc2Zvcm1lcigpXG4gICAgdGhpcy5tYWtlUmVxdWVzdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSwgJycsIFsyMDBdLCAnJywgdHJ1ZSwgKGUsIHJlc3BvbnNlKSA9PiB7XG4gICAgICBpZiAoZSkge1xuICAgICAgICByZXR1cm4gdHJhbnNmb3JtZXIuZW1pdCgnZXJyb3InLCBlKVxuICAgICAgfVxuICAgICAgcGlwZXNldHVwKHJlc3BvbnNlLCB0cmFuc2Zvcm1lcilcbiAgICB9KVxuICAgIHJldHVybiB0cmFuc2Zvcm1lclxuICB9XG5cbiAgLy8gTGlzdCB0aGUgb2JqZWN0cyBpbiB0aGUgYnVja2V0IHVzaW5nIFMzIExpc3RPYmplY3RzIFYyXG4gIC8vXG4gIC8vIF9fQXJndW1lbnRzX19cbiAgLy8gKiBgYnVja2V0TmFtZWAgX3N0cmluZ186IG5hbWUgb2YgdGhlIGJ1Y2tldFxuICAvLyAqIGBwcmVmaXhgIF9zdHJpbmdfOiB0aGUgcHJlZml4IG9mIHRoZSBvYmplY3RzIHRoYXQgc2hvdWxkIGJlIGxpc3RlZCAob3B0aW9uYWwsIGRlZmF1bHQgYCcnYClcbiAgLy8gKiBgcmVjdXJzaXZlYCBfYm9vbF86IGB0cnVlYCBpbmRpY2F0ZXMgcmVjdXJzaXZlIHN0eWxlIGxpc3RpbmcgYW5kIGBmYWxzZWAgaW5kaWNhdGVzIGRpcmVjdG9yeSBzdHlsZSBsaXN0aW5nIGRlbGltaXRlZCBieSAnLycuIChvcHRpb25hbCwgZGVmYXVsdCBgZmFsc2VgKVxuICAvLyAqIGBzdGFydEFmdGVyYCBfc3RyaW5nXzogU3BlY2lmaWVzIHRoZSBrZXkgdG8gc3RhcnQgYWZ0ZXIgd2hlbiBsaXN0aW5nIG9iamVjdHMgaW4gYSBidWNrZXQuIChvcHRpb25hbCwgZGVmYXVsdCBgJydgKVxuICAvL1xuICAvLyBfX1JldHVybiBWYWx1ZV9fXG4gIC8vICogYHN0cmVhbWAgX1N0cmVhbV86IHN0cmVhbSBlbWl0dGluZyB0aGUgb2JqZWN0cyBpbiB0aGUgYnVja2V0LCB0aGUgb2JqZWN0IGlzIG9mIHRoZSBmb3JtYXQ6XG4gIC8vICAgKiBgb2JqLm5hbWVgIF9zdHJpbmdfOiBuYW1lIG9mIHRoZSBvYmplY3RcbiAgLy8gICAqIGBvYmoucHJlZml4YCBfc3RyaW5nXzogbmFtZSBvZiB0aGUgb2JqZWN0IHByZWZpeFxuICAvLyAgICogYG9iai5zaXplYCBfbnVtYmVyXzogc2l6ZSBvZiB0aGUgb2JqZWN0XG4gIC8vICAgKiBgb2JqLmV0YWdgIF9zdHJpbmdfOiBldGFnIG9mIHRoZSBvYmplY3RcbiAgLy8gICAqIGBvYmoubGFzdE1vZGlmaWVkYCBfRGF0ZV86IG1vZGlmaWVkIHRpbWUgc3RhbXBcbiAgbGlzdE9iamVjdHNWMihidWNrZXROYW1lLCBwcmVmaXgsIHJlY3Vyc2l2ZSwgc3RhcnRBZnRlcikge1xuICAgIGlmIChwcmVmaXggPT09IHVuZGVmaW5lZCkge1xuICAgICAgcHJlZml4ID0gJydcbiAgICB9XG4gICAgaWYgKHJlY3Vyc2l2ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICByZWN1cnNpdmUgPSBmYWxzZVxuICAgIH1cbiAgICBpZiAoc3RhcnRBZnRlciA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBzdGFydEFmdGVyID0gJydcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkUHJlZml4KHByZWZpeCkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZFByZWZpeEVycm9yKGBJbnZhbGlkIHByZWZpeCA6ICR7cHJlZml4fWApXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcocHJlZml4KSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncHJlZml4IHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoIWlzQm9vbGVhbihyZWN1cnNpdmUpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZWN1cnNpdmUgc2hvdWxkIGJlIG9mIHR5cGUgXCJib29sZWFuXCInKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHN0YXJ0QWZ0ZXIpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdzdGFydEFmdGVyIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICAvLyBpZiByZWN1cnNpdmUgaXMgZmFsc2Ugc2V0IGRlbGltaXRlciB0byAnLydcbiAgICB2YXIgZGVsaW1pdGVyID0gcmVjdXJzaXZlID8gJycgOiAnLydcbiAgICB2YXIgY29udGludWF0aW9uVG9rZW4gPSAnJ1xuICAgIHZhciBvYmplY3RzID0gW11cbiAgICB2YXIgZW5kZWQgPSBmYWxzZVxuICAgIHZhciByZWFkU3RyZWFtID0gU3RyZWFtLlJlYWRhYmxlKHsgb2JqZWN0TW9kZTogdHJ1ZSB9KVxuICAgIHJlYWRTdHJlYW0uX3JlYWQgPSAoKSA9PiB7XG4gICAgICAvLyBwdXNoIG9uZSBvYmplY3QgcGVyIF9yZWFkKClcbiAgICAgIGlmIChvYmplY3RzLmxlbmd0aCkge1xuICAgICAgICByZWFkU3RyZWFtLnB1c2gob2JqZWN0cy5zaGlmdCgpKVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cbiAgICAgIGlmIChlbmRlZCkge1xuICAgICAgICByZXR1cm4gcmVhZFN0cmVhbS5wdXNoKG51bGwpXG4gICAgICB9XG4gICAgICAvLyBpZiB0aGVyZSBhcmUgbm8gb2JqZWN0cyB0byBwdXNoIGRvIHF1ZXJ5IGZvciB0aGUgbmV4dCBiYXRjaCBvZiBvYmplY3RzXG4gICAgICB0aGlzLmxpc3RPYmplY3RzVjJRdWVyeShidWNrZXROYW1lLCBwcmVmaXgsIGNvbnRpbnVhdGlvblRva2VuLCBkZWxpbWl0ZXIsIDEwMDAsIHN0YXJ0QWZ0ZXIpXG4gICAgICAgIC5vbignZXJyb3InLCAoZSkgPT4gcmVhZFN0cmVhbS5lbWl0KCdlcnJvcicsIGUpKVxuICAgICAgICAub24oJ2RhdGEnLCAocmVzdWx0KSA9PiB7XG4gICAgICAgICAgaWYgKHJlc3VsdC5pc1RydW5jYXRlZCkge1xuICAgICAgICAgICAgY29udGludWF0aW9uVG9rZW4gPSByZXN1bHQubmV4dENvbnRpbnVhdGlvblRva2VuXG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGVuZGVkID0gdHJ1ZVxuICAgICAgICAgIH1cbiAgICAgICAgICBvYmplY3RzID0gcmVzdWx0Lm9iamVjdHNcbiAgICAgICAgICByZWFkU3RyZWFtLl9yZWFkKClcbiAgICAgICAgfSlcbiAgICB9XG4gICAgcmV0dXJuIHJlYWRTdHJlYW1cbiAgfVxuXG4gIC8vIFJlbW92ZSBhbGwgdGhlIG9iamVjdHMgcmVzaWRpbmcgaW4gdGhlIG9iamVjdHNMaXN0LlxuICAvL1xuICAvLyBfX0FyZ3VtZW50c19fXG4gIC8vICogYGJ1Y2tldE5hbWVgIF9zdHJpbmdfOiBuYW1lIG9mIHRoZSBidWNrZXRcbiAgLy8gKiBgb2JqZWN0c0xpc3RgIF9hcnJheV86IGFycmF5IG9mIG9iamVjdHMgb2Ygb25lIG9mIHRoZSBmb2xsb3dpbmc6XG4gIC8vICogICAgICAgICBMaXN0IG9mIE9iamVjdCBuYW1lcyBhcyBhcnJheSBvZiBzdHJpbmdzIHdoaWNoIGFyZSBvYmplY3Qga2V5czogIFsnb2JqZWN0bmFtZTEnLCdvYmplY3RuYW1lMiddXG4gIC8vICogICAgICAgICBMaXN0IG9mIE9iamVjdCBuYW1lIGFuZCB2ZXJzaW9uSWQgYXMgYW4gb2JqZWN0OiAgW3tuYW1lOlwib2JqZWN0bmFtZVwiLHZlcnNpb25JZDpcIm15LXZlcnNpb24taWRcIn1dXG5cbiAgcmVtb3ZlT2JqZWN0cyhidWNrZXROYW1lLCBvYmplY3RzTGlzdCwgY2IpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkob2JqZWN0c0xpc3QpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdvYmplY3RzTGlzdCBzaG91bGQgYmUgYSBsaXN0JylcbiAgICB9XG4gICAgaWYgKCFpc0Z1bmN0aW9uKGNiKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignY2FsbGJhY2sgc2hvdWxkIGJlIG9mIHR5cGUgXCJmdW5jdGlvblwiJylcbiAgICB9XG5cbiAgICBjb25zdCBtYXhFbnRyaWVzID0gMTAwMFxuICAgIGNvbnN0IHF1ZXJ5ID0gJ2RlbGV0ZSdcbiAgICBjb25zdCBtZXRob2QgPSAnUE9TVCdcblxuICAgIGxldCByZXN1bHQgPSBvYmplY3RzTGlzdC5yZWR1Y2UoXG4gICAgICAocmVzdWx0LCBlbnRyeSkgPT4ge1xuICAgICAgICByZXN1bHQubGlzdC5wdXNoKGVudHJ5KVxuICAgICAgICBpZiAocmVzdWx0Lmxpc3QubGVuZ3RoID09PSBtYXhFbnRyaWVzKSB7XG4gICAgICAgICAgcmVzdWx0Lmxpc3RPZkxpc3QucHVzaChyZXN1bHQubGlzdClcbiAgICAgICAgICByZXN1bHQubGlzdCA9IFtdXG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJlc3VsdFxuICAgICAgfSxcbiAgICAgIHsgbGlzdE9mTGlzdDogW10sIGxpc3Q6IFtdIH0sXG4gICAgKVxuXG4gICAgaWYgKHJlc3VsdC5saXN0Lmxlbmd0aCA+IDApIHtcbiAgICAgIHJlc3VsdC5saXN0T2ZMaXN0LnB1c2gocmVzdWx0Lmxpc3QpXG4gICAgfVxuXG4gICAgY29uc3QgZW5jb2RlciA9IG5ldyBUZXh0RW5jb2RlcigpXG4gICAgY29uc3QgYmF0Y2hSZXN1bHRzID0gW11cblxuICAgIGFzeW5jLmVhY2hTZXJpZXMoXG4gICAgICByZXN1bHQubGlzdE9mTGlzdCxcbiAgICAgIChsaXN0LCBiYXRjaENiKSA9PiB7XG4gICAgICAgIHZhciBvYmplY3RzID0gW11cbiAgICAgICAgbGlzdC5mb3JFYWNoKGZ1bmN0aW9uICh2YWx1ZSkge1xuICAgICAgICAgIGlmIChpc09iamVjdCh2YWx1ZSkpIHtcbiAgICAgICAgICAgIG9iamVjdHMucHVzaCh7IEtleTogdmFsdWUubmFtZSwgVmVyc2lvbklkOiB2YWx1ZS52ZXJzaW9uSWQgfSlcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgb2JqZWN0cy5wdXNoKHsgS2V5OiB2YWx1ZSB9KVxuICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICAgICAgbGV0IGRlbGV0ZU9iamVjdHMgPSB7IERlbGV0ZTogeyBRdWlldDogdHJ1ZSwgT2JqZWN0OiBvYmplY3RzIH0gfVxuICAgICAgICBjb25zdCBidWlsZGVyID0gbmV3IHhtbDJqcy5CdWlsZGVyKHsgaGVhZGxlc3M6IHRydWUgfSlcbiAgICAgICAgbGV0IHBheWxvYWQgPSBidWlsZGVyLmJ1aWxkT2JqZWN0KGRlbGV0ZU9iamVjdHMpXG4gICAgICAgIHBheWxvYWQgPSBCdWZmZXIuZnJvbShlbmNvZGVyLmVuY29kZShwYXlsb2FkKSlcbiAgICAgICAgY29uc3QgaGVhZGVycyA9IHt9XG5cbiAgICAgICAgaGVhZGVyc1snQ29udGVudC1NRDUnXSA9IHRvTWQ1KHBheWxvYWQpXG5cbiAgICAgICAgbGV0IHJlbW92ZU9iamVjdHNSZXN1bHRcbiAgICAgICAgdGhpcy5tYWtlUmVxdWVzdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnksIGhlYWRlcnMgfSwgcGF5bG9hZCwgWzIwMF0sICcnLCB0cnVlLCAoZSwgcmVzcG9uc2UpID0+IHtcbiAgICAgICAgICBpZiAoZSkge1xuICAgICAgICAgICAgcmV0dXJuIGJhdGNoQ2IoZSlcbiAgICAgICAgICB9XG4gICAgICAgICAgcGlwZXNldHVwKHJlc3BvbnNlLCB0cmFuc2Zvcm1lcnMucmVtb3ZlT2JqZWN0c1RyYW5zZm9ybWVyKCkpXG4gICAgICAgICAgICAub24oJ2RhdGEnLCAoZGF0YSkgPT4ge1xuICAgICAgICAgICAgICByZW1vdmVPYmplY3RzUmVzdWx0ID0gZGF0YVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIC5vbignZXJyb3InLCAoZSkgPT4ge1xuICAgICAgICAgICAgICByZXR1cm4gYmF0Y2hDYihlLCBudWxsKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIC5vbignZW5kJywgKCkgPT4ge1xuICAgICAgICAgICAgICBiYXRjaFJlc3VsdHMucHVzaChyZW1vdmVPYmplY3RzUmVzdWx0KVxuICAgICAgICAgICAgICByZXR1cm4gYmF0Y2hDYihudWxsLCByZW1vdmVPYmplY3RzUmVzdWx0KVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfSlcbiAgICAgIH0sXG4gICAgICAoKSA9PiB7XG4gICAgICAgIGNiKG51bGwsIF8uZmxhdHRlbihiYXRjaFJlc3VsdHMpKVxuICAgICAgfSxcbiAgICApXG4gIH1cblxuICAvLyBHZW5lcmF0ZSBhIGdlbmVyaWMgcHJlc2lnbmVkIFVSTCB3aGljaCBjYW4gYmVcbiAgLy8gdXNlZCBmb3IgSFRUUCBtZXRob2RzIEdFVCwgUFVULCBIRUFEIGFuZCBERUxFVEVcbiAgLy9cbiAgLy8gX19Bcmd1bWVudHNfX1xuICAvLyAqIGBtZXRob2RgIF9zdHJpbmdfOiBuYW1lIG9mIHRoZSBIVFRQIG1ldGhvZFxuICAvLyAqIGBidWNrZXROYW1lYCBfc3RyaW5nXzogbmFtZSBvZiB0aGUgYnVja2V0XG4gIC8vICogYG9iamVjdE5hbWVgIF9zdHJpbmdfOiBuYW1lIG9mIHRoZSBvYmplY3RcbiAgLy8gKiBgZXhwaXJ5YCBfbnVtYmVyXzogZXhwaXJ5IGluIHNlY29uZHMgKG9wdGlvbmFsLCBkZWZhdWx0IDcgZGF5cylcbiAgLy8gKiBgcmVxUGFyYW1zYCBfb2JqZWN0XzogcmVxdWVzdCBwYXJhbWV0ZXJzIChvcHRpb25hbCkgZS5nIHt2ZXJzaW9uSWQ6XCIxMGZhOTk0Ni0zZjY0LTQxMzctYTU4Zi04ODgwNjVjMDczMmVcIn1cbiAgLy8gKiBgcmVxdWVzdERhdGVgIF9EYXRlXzogQSBkYXRlIG9iamVjdCwgdGhlIHVybCB3aWxsIGJlIGlzc3VlZCBhdCAob3B0aW9uYWwpXG4gIHByZXNpZ25lZFVybChtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGV4cGlyZXMsIHJlcVBhcmFtcywgcmVxdWVzdERhdGUsIGNiKSB7XG4gICAgaWYgKHRoaXMuYW5vbnltb3VzKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkFub255bW91c1JlcXVlc3RFcnJvcignUHJlc2lnbmVkICcgKyBtZXRob2QgKyAnIHVybCBjYW5ub3QgYmUgZ2VuZXJhdGVkIGZvciBhbm9ueW1vdXMgcmVxdWVzdHMnKVxuICAgIH1cbiAgICBpZiAoaXNGdW5jdGlvbihyZXF1ZXN0RGF0ZSkpIHtcbiAgICAgIGNiID0gcmVxdWVzdERhdGVcbiAgICAgIHJlcXVlc3REYXRlID0gbmV3IERhdGUoKVxuICAgIH1cbiAgICBpZiAoaXNGdW5jdGlvbihyZXFQYXJhbXMpKSB7XG4gICAgICBjYiA9IHJlcVBhcmFtc1xuICAgICAgcmVxUGFyYW1zID0ge31cbiAgICAgIHJlcXVlc3REYXRlID0gbmV3IERhdGUoKVxuICAgIH1cbiAgICBpZiAoaXNGdW5jdGlvbihleHBpcmVzKSkge1xuICAgICAgY2IgPSBleHBpcmVzXG4gICAgICByZXFQYXJhbXMgPSB7fVxuICAgICAgZXhwaXJlcyA9IDI0ICogNjAgKiA2MCAqIDcgLy8gNyBkYXlzIGluIHNlY29uZHNcbiAgICAgIHJlcXVlc3REYXRlID0gbmV3IERhdGUoKVxuICAgIH1cbiAgICBpZiAoIWlzTnVtYmVyKGV4cGlyZXMpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdleHBpcmVzIHNob3VsZCBiZSBvZiB0eXBlIFwibnVtYmVyXCInKVxuICAgIH1cbiAgICBpZiAoIWlzT2JqZWN0KHJlcVBhcmFtcykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3JlcVBhcmFtcyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkRGF0ZShyZXF1ZXN0RGF0ZSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3JlcXVlc3REYXRlIHNob3VsZCBiZSBvZiB0eXBlIFwiRGF0ZVwiIGFuZCB2YWxpZCcpXG4gICAgfVxuICAgIGlmICghaXNGdW5jdGlvbihjYikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2NhbGxiYWNrIHNob3VsZCBiZSBvZiB0eXBlIFwiZnVuY3Rpb25cIicpXG4gICAgfVxuICAgIHZhciBxdWVyeSA9IHF1ZXJ5c3RyaW5nLnN0cmluZ2lmeShyZXFQYXJhbXMpXG4gICAgdGhpcy5nZXRCdWNrZXRSZWdpb24oYnVja2V0TmFtZSwgKGUsIHJlZ2lvbikgPT4ge1xuICAgICAgaWYgKGUpIHtcbiAgICAgICAgcmV0dXJuIGNiKGUpXG4gICAgICB9XG4gICAgICAvLyBUaGlzIHN0YXRlbWVudCBpcyBhZGRlZCB0byBlbnN1cmUgdGhhdCB3ZSBzZW5kIGVycm9yIHRocm91Z2hcbiAgICAgIC8vIGNhbGxiYWNrIG9uIHByZXNpZ24gZmFpbHVyZS5cbiAgICAgIHZhciB1cmxcbiAgICAgIHZhciByZXFPcHRpb25zID0gdGhpcy5nZXRSZXF1ZXN0T3B0aW9ucyh7IG1ldGhvZCwgcmVnaW9uLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSB9KVxuXG4gICAgICB0aGlzLmNoZWNrQW5kUmVmcmVzaENyZWRzKClcbiAgICAgIHRyeSB7XG4gICAgICAgIHVybCA9IHByZXNpZ25TaWduYXR1cmVWNChcbiAgICAgICAgICByZXFPcHRpb25zLFxuICAgICAgICAgIHRoaXMuYWNjZXNzS2V5LFxuICAgICAgICAgIHRoaXMuc2VjcmV0S2V5LFxuICAgICAgICAgIHRoaXMuc2Vzc2lvblRva2VuLFxuICAgICAgICAgIHJlZ2lvbixcbiAgICAgICAgICByZXF1ZXN0RGF0ZSxcbiAgICAgICAgICBleHBpcmVzLFxuICAgICAgICApXG4gICAgICB9IGNhdGNoIChwZSkge1xuICAgICAgICByZXR1cm4gY2IocGUpXG4gICAgICB9XG4gICAgICBjYihudWxsLCB1cmwpXG4gICAgfSlcbiAgfVxuXG4gIC8vIEdlbmVyYXRlIGEgcHJlc2lnbmVkIFVSTCBmb3IgR0VUXG4gIC8vXG4gIC8vIF9fQXJndW1lbnRzX19cbiAgLy8gKiBgYnVja2V0TmFtZWAgX3N0cmluZ186IG5hbWUgb2YgdGhlIGJ1Y2tldFxuICAvLyAqIGBvYmplY3ROYW1lYCBfc3RyaW5nXzogbmFtZSBvZiB0aGUgb2JqZWN0XG4gIC8vICogYGV4cGlyeWAgX251bWJlcl86IGV4cGlyeSBpbiBzZWNvbmRzIChvcHRpb25hbCwgZGVmYXVsdCA3IGRheXMpXG4gIC8vICogYHJlc3BIZWFkZXJzYCBfb2JqZWN0XzogcmVzcG9uc2UgaGVhZGVycyB0byBvdmVycmlkZSBvciByZXF1ZXN0IHBhcmFtcyBmb3IgcXVlcnkgKG9wdGlvbmFsKSBlLmcge3ZlcnNpb25JZDpcIjEwZmE5OTQ2LTNmNjQtNDEzNy1hNThmLTg4ODA2NWMwNzMyZVwifVxuICAvLyAqIGByZXF1ZXN0RGF0ZWAgX0RhdGVfOiBBIGRhdGUgb2JqZWN0LCB0aGUgdXJsIHdpbGwgYmUgaXNzdWVkIGF0IChvcHRpb25hbClcbiAgcHJlc2lnbmVkR2V0T2JqZWN0KGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGV4cGlyZXMsIHJlc3BIZWFkZXJzLCByZXF1ZXN0RGF0ZSwgY2IpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cblxuICAgIGlmIChpc0Z1bmN0aW9uKHJlc3BIZWFkZXJzKSkge1xuICAgICAgY2IgPSByZXNwSGVhZGVyc1xuICAgICAgcmVzcEhlYWRlcnMgPSB7fVxuICAgICAgcmVxdWVzdERhdGUgPSBuZXcgRGF0ZSgpXG4gICAgfVxuXG4gICAgdmFyIHZhbGlkUmVzcEhlYWRlcnMgPSBbXG4gICAgICAncmVzcG9uc2UtY29udGVudC10eXBlJyxcbiAgICAgICdyZXNwb25zZS1jb250ZW50LWxhbmd1YWdlJyxcbiAgICAgICdyZXNwb25zZS1leHBpcmVzJyxcbiAgICAgICdyZXNwb25zZS1jYWNoZS1jb250cm9sJyxcbiAgICAgICdyZXNwb25zZS1jb250ZW50LWRpc3Bvc2l0aW9uJyxcbiAgICAgICdyZXNwb25zZS1jb250ZW50LWVuY29kaW5nJyxcbiAgICBdXG4gICAgdmFsaWRSZXNwSGVhZGVycy5mb3JFYWNoKChoZWFkZXIpID0+IHtcbiAgICAgIGlmIChyZXNwSGVhZGVycyAhPT0gdW5kZWZpbmVkICYmIHJlc3BIZWFkZXJzW2hlYWRlcl0gIT09IHVuZGVmaW5lZCAmJiAhaXNTdHJpbmcocmVzcEhlYWRlcnNbaGVhZGVyXSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgcmVzcG9uc2UgaGVhZGVyICR7aGVhZGVyfSBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiYClcbiAgICAgIH1cbiAgICB9KVxuICAgIHJldHVybiB0aGlzLnByZXNpZ25lZFVybCgnR0VUJywgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgZXhwaXJlcywgcmVzcEhlYWRlcnMsIHJlcXVlc3REYXRlLCBjYilcbiAgfVxuXG4gIC8vIEdlbmVyYXRlIGEgcHJlc2lnbmVkIFVSTCBmb3IgUFVULiBVc2luZyB0aGlzIFVSTCwgdGhlIGJyb3dzZXIgY2FuIHVwbG9hZCB0byBTMyBvbmx5IHdpdGggdGhlIHNwZWNpZmllZCBvYmplY3QgbmFtZS5cbiAgLy9cbiAgLy8gX19Bcmd1bWVudHNfX1xuICAvLyAqIGBidWNrZXROYW1lYCBfc3RyaW5nXzogbmFtZSBvZiB0aGUgYnVja2V0XG4gIC8vICogYG9iamVjdE5hbWVgIF9zdHJpbmdfOiBuYW1lIG9mIHRoZSBvYmplY3RcbiAgLy8gKiBgZXhwaXJ5YCBfbnVtYmVyXzogZXhwaXJ5IGluIHNlY29uZHMgKG9wdGlvbmFsLCBkZWZhdWx0IDcgZGF5cylcbiAgcHJlc2lnbmVkUHV0T2JqZWN0KGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGV4cGlyZXMsIGNiKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKGBJbnZhbGlkIGJ1Y2tldCBuYW1lOiAke2J1Y2tldE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMucHJlc2lnbmVkVXJsKCdQVVQnLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBleHBpcmVzLCBjYilcbiAgfVxuXG4gIC8vIHJldHVybiBQb3N0UG9saWN5IG9iamVjdFxuICBuZXdQb3N0UG9saWN5KCkge1xuICAgIHJldHVybiBuZXcgUG9zdFBvbGljeSgpXG4gIH1cblxuICAvLyBwcmVzaWduZWRQb3N0UG9saWN5IGNhbiBiZSB1c2VkIGluIHNpdHVhdGlvbnMgd2hlcmUgd2Ugd2FudCBtb3JlIGNvbnRyb2wgb24gdGhlIHVwbG9hZCB0aGFuIHdoYXRcbiAgLy8gcHJlc2lnbmVkUHV0T2JqZWN0KCkgcHJvdmlkZXMuIGkuZSBVc2luZyBwcmVzaWduZWRQb3N0UG9saWN5IHdlIHdpbGwgYmUgYWJsZSB0byBwdXQgcG9saWN5IHJlc3RyaWN0aW9uc1xuICAvLyBvbiB0aGUgb2JqZWN0J3MgYG5hbWVgIGBidWNrZXRgIGBleHBpcnlgIGBDb250ZW50LVR5cGVgIGBDb250ZW50LURpc3Bvc2l0aW9uYCBgbWV0YURhdGFgXG4gIHByZXNpZ25lZFBvc3RQb2xpY3kocG9zdFBvbGljeSwgY2IpIHtcbiAgICBpZiAodGhpcy5hbm9ueW1vdXMpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuQW5vbnltb3VzUmVxdWVzdEVycm9yKCdQcmVzaWduZWQgUE9TVCBwb2xpY3kgY2Fubm90IGJlIGdlbmVyYXRlZCBmb3IgYW5vbnltb3VzIHJlcXVlc3RzJylcbiAgICB9XG4gICAgaWYgKCFpc09iamVjdChwb3N0UG9saWN5KSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncG9zdFBvbGljeSBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG4gICAgaWYgKCFpc0Z1bmN0aW9uKGNiKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignY2Igc2hvdWxkIGJlIG9mIHR5cGUgXCJmdW5jdGlvblwiJylcbiAgICB9XG4gICAgdGhpcy5nZXRCdWNrZXRSZWdpb24ocG9zdFBvbGljeS5mb3JtRGF0YS5idWNrZXQsIChlLCByZWdpb24pID0+IHtcbiAgICAgIGlmIChlKSB7XG4gICAgICAgIHJldHVybiBjYihlKVxuICAgICAgfVxuICAgICAgdmFyIGRhdGUgPSBuZXcgRGF0ZSgpXG4gICAgICB2YXIgZGF0ZVN0ciA9IG1ha2VEYXRlTG9uZyhkYXRlKVxuXG4gICAgICB0aGlzLmNoZWNrQW5kUmVmcmVzaENyZWRzKClcblxuICAgICAgaWYgKCFwb3N0UG9saWN5LnBvbGljeS5leHBpcmF0aW9uKSB7XG4gICAgICAgIC8vICdleHBpcmF0aW9uJyBpcyBtYW5kYXRvcnkgZmllbGQgZm9yIFMzLlxuICAgICAgICAvLyBTZXQgZGVmYXVsdCBleHBpcmF0aW9uIGRhdGUgb2YgNyBkYXlzLlxuICAgICAgICB2YXIgZXhwaXJlcyA9IG5ldyBEYXRlKClcbiAgICAgICAgZXhwaXJlcy5zZXRTZWNvbmRzKDI0ICogNjAgKiA2MCAqIDcpXG4gICAgICAgIHBvc3RQb2xpY3kuc2V0RXhwaXJlcyhleHBpcmVzKVxuICAgICAgfVxuXG4gICAgICBwb3N0UG9saWN5LnBvbGljeS5jb25kaXRpb25zLnB1c2goWydlcScsICckeC1hbXotZGF0ZScsIGRhdGVTdHJdKVxuICAgICAgcG9zdFBvbGljeS5mb3JtRGF0YVsneC1hbXotZGF0ZSddID0gZGF0ZVN0clxuXG4gICAgICBwb3N0UG9saWN5LnBvbGljeS5jb25kaXRpb25zLnB1c2goWydlcScsICckeC1hbXotYWxnb3JpdGhtJywgJ0FXUzQtSE1BQy1TSEEyNTYnXSlcbiAgICAgIHBvc3RQb2xpY3kuZm9ybURhdGFbJ3gtYW16LWFsZ29yaXRobSddID0gJ0FXUzQtSE1BQy1TSEEyNTYnXG5cbiAgICAgIHBvc3RQb2xpY3kucG9saWN5LmNvbmRpdGlvbnMucHVzaChbJ2VxJywgJyR4LWFtei1jcmVkZW50aWFsJywgdGhpcy5hY2Nlc3NLZXkgKyAnLycgKyBnZXRTY29wZShyZWdpb24sIGRhdGUpXSlcbiAgICAgIHBvc3RQb2xpY3kuZm9ybURhdGFbJ3gtYW16LWNyZWRlbnRpYWwnXSA9IHRoaXMuYWNjZXNzS2V5ICsgJy8nICsgZ2V0U2NvcGUocmVnaW9uLCBkYXRlKVxuXG4gICAgICBpZiAodGhpcy5zZXNzaW9uVG9rZW4pIHtcbiAgICAgICAgcG9zdFBvbGljeS5wb2xpY3kuY29uZGl0aW9ucy5wdXNoKFsnZXEnLCAnJHgtYW16LXNlY3VyaXR5LXRva2VuJywgdGhpcy5zZXNzaW9uVG9rZW5dKVxuICAgICAgICBwb3N0UG9saWN5LmZvcm1EYXRhWyd4LWFtei1zZWN1cml0eS10b2tlbiddID0gdGhpcy5zZXNzaW9uVG9rZW5cbiAgICAgIH1cblxuICAgICAgdmFyIHBvbGljeUJhc2U2NCA9IEJ1ZmZlci5mcm9tKEpTT04uc3RyaW5naWZ5KHBvc3RQb2xpY3kucG9saWN5KSkudG9TdHJpbmcoJ2Jhc2U2NCcpXG5cbiAgICAgIHBvc3RQb2xpY3kuZm9ybURhdGEucG9saWN5ID0gcG9saWN5QmFzZTY0XG5cbiAgICAgIHZhciBzaWduYXR1cmUgPSBwb3N0UHJlc2lnblNpZ25hdHVyZVY0KHJlZ2lvbiwgZGF0ZSwgdGhpcy5zZWNyZXRLZXksIHBvbGljeUJhc2U2NClcblxuICAgICAgcG9zdFBvbGljeS5mb3JtRGF0YVsneC1hbXotc2lnbmF0dXJlJ10gPSBzaWduYXR1cmVcbiAgICAgIHZhciBvcHRzID0ge31cbiAgICAgIG9wdHMucmVnaW9uID0gcmVnaW9uXG4gICAgICBvcHRzLmJ1Y2tldE5hbWUgPSBwb3N0UG9saWN5LmZvcm1EYXRhLmJ1Y2tldFxuICAgICAgdmFyIHJlcU9wdGlvbnMgPSB0aGlzLmdldFJlcXVlc3RPcHRpb25zKG9wdHMpXG4gICAgICB2YXIgcG9ydFN0ciA9IHRoaXMucG9ydCA9PSA4MCB8fCB0aGlzLnBvcnQgPT09IDQ0MyA/ICcnIDogYDoke3RoaXMucG9ydC50b1N0cmluZygpfWBcbiAgICAgIHZhciB1cmxTdHIgPSBgJHtyZXFPcHRpb25zLnByb3RvY29sfS8vJHtyZXFPcHRpb25zLmhvc3R9JHtwb3J0U3RyfSR7cmVxT3B0aW9ucy5wYXRofWBcbiAgICAgIGNiKG51bGwsIHsgcG9zdFVSTDogdXJsU3RyLCBmb3JtRGF0YTogcG9zdFBvbGljeS5mb3JtRGF0YSB9KVxuICAgIH0pXG4gIH1cblxuICAvLyBSZW1vdmUgYWxsIHRoZSBub3RpZmljYXRpb24gY29uZmlndXJhdGlvbnMgaW4gdGhlIFMzIHByb3ZpZGVyXG4gIHNldEJ1Y2tldE5vdGlmaWNhdGlvbihidWNrZXROYW1lLCBjb25maWcsIGNiKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc09iamVjdChjb25maWcpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdub3RpZmljYXRpb24gY29uZmlnIHNob3VsZCBiZSBvZiB0eXBlIFwiT2JqZWN0XCInKVxuICAgIH1cbiAgICBpZiAoIWlzRnVuY3Rpb24oY2IpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdjYWxsYmFjayBzaG91bGQgYmUgb2YgdHlwZSBcImZ1bmN0aW9uXCInKVxuICAgIH1cbiAgICB2YXIgbWV0aG9kID0gJ1BVVCdcbiAgICB2YXIgcXVlcnkgPSAnbm90aWZpY2F0aW9uJ1xuICAgIHZhciBidWlsZGVyID0gbmV3IHhtbDJqcy5CdWlsZGVyKHtcbiAgICAgIHJvb3ROYW1lOiAnTm90aWZpY2F0aW9uQ29uZmlndXJhdGlvbicsXG4gICAgICByZW5kZXJPcHRzOiB7IHByZXR0eTogZmFsc2UgfSxcbiAgICAgIGhlYWRsZXNzOiB0cnVlLFxuICAgIH0pXG4gICAgdmFyIHBheWxvYWQgPSBidWlsZGVyLmJ1aWxkT2JqZWN0KGNvbmZpZylcbiAgICB0aGlzLm1ha2VSZXF1ZXN0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9LCBwYXlsb2FkLCBbMjAwXSwgJycsIGZhbHNlLCBjYilcbiAgfVxuXG4gIHJlbW92ZUFsbEJ1Y2tldE5vdGlmaWNhdGlvbihidWNrZXROYW1lLCBjYikge1xuICAgIHRoaXMuc2V0QnVja2V0Tm90aWZpY2F0aW9uKGJ1Y2tldE5hbWUsIG5ldyBOb3RpZmljYXRpb25Db25maWcoKSwgY2IpXG4gIH1cblxuICAvLyBSZXR1cm4gdGhlIGxpc3Qgb2Ygbm90aWZpY2F0aW9uIGNvbmZpZ3VyYXRpb25zIHN0b3JlZFxuICAvLyBpbiB0aGUgUzMgcHJvdmlkZXJcbiAgZ2V0QnVja2V0Tm90aWZpY2F0aW9uKGJ1Y2tldE5hbWUsIGNiKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc0Z1bmN0aW9uKGNiKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignY2FsbGJhY2sgc2hvdWxkIGJlIG9mIHR5cGUgXCJmdW5jdGlvblwiJylcbiAgICB9XG4gICAgdmFyIG1ldGhvZCA9ICdHRVQnXG4gICAgdmFyIHF1ZXJ5ID0gJ25vdGlmaWNhdGlvbidcbiAgICB0aGlzLm1ha2VSZXF1ZXN0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9LCAnJywgWzIwMF0sICcnLCB0cnVlLCAoZSwgcmVzcG9uc2UpID0+IHtcbiAgICAgIGlmIChlKSB7XG4gICAgICAgIHJldHVybiBjYihlKVxuICAgICAgfVxuICAgICAgdmFyIHRyYW5zZm9ybWVyID0gdHJhbnNmb3JtZXJzLmdldEJ1Y2tldE5vdGlmaWNhdGlvblRyYW5zZm9ybWVyKClcbiAgICAgIHZhciBidWNrZXROb3RpZmljYXRpb25cbiAgICAgIHBpcGVzZXR1cChyZXNwb25zZSwgdHJhbnNmb3JtZXIpXG4gICAgICAgIC5vbignZGF0YScsIChyZXN1bHQpID0+IChidWNrZXROb3RpZmljYXRpb24gPSByZXN1bHQpKVxuICAgICAgICAub24oJ2Vycm9yJywgKGUpID0+IGNiKGUpKVxuICAgICAgICAub24oJ2VuZCcsICgpID0+IGNiKG51bGwsIGJ1Y2tldE5vdGlmaWNhdGlvbikpXG4gICAgfSlcbiAgfVxuXG4gIC8vIExpc3RlbnMgZm9yIGJ1Y2tldCBub3RpZmljYXRpb25zLiBSZXR1cm5zIGFuIEV2ZW50RW1pdHRlci5cbiAgbGlzdGVuQnVja2V0Tm90aWZpY2F0aW9uKGJ1Y2tldE5hbWUsIHByZWZpeCwgc3VmZml4LCBldmVudHMpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoYEludmFsaWQgYnVja2V0IG5hbWU6ICR7YnVja2V0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHByZWZpeCkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3ByZWZpeCBtdXN0IGJlIG9mIHR5cGUgc3RyaW5nJylcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhzdWZmaXgpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdzdWZmaXggbXVzdCBiZSBvZiB0eXBlIHN0cmluZycpXG4gICAgfVxuICAgIGlmICghQXJyYXkuaXNBcnJheShldmVudHMpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdldmVudHMgbXVzdCBiZSBvZiB0eXBlIEFycmF5JylcbiAgICB9XG4gICAgbGV0IGxpc3RlbmVyID0gbmV3IE5vdGlmaWNhdGlvblBvbGxlcih0aGlzLCBidWNrZXROYW1lLCBwcmVmaXgsIHN1ZmZpeCwgZXZlbnRzKVxuICAgIGxpc3RlbmVyLnN0YXJ0KClcblxuICAgIHJldHVybiBsaXN0ZW5lclxuICB9XG5cbiAgLyoqIFRvIHNldCBUYWdzIG9uIGEgYnVja2V0IG9yIG9iamVjdCBiYXNlZCBvbiB0aGUgcGFyYW1zXG4gICAqICBfX0FyZ3VtZW50c19fXG4gICAqIHRhZ2dpbmdQYXJhbXMgX29iamVjdF8gV2hpY2ggY29udGFpbnMgdGhlIGZvbGxvd2luZyBwcm9wZXJ0aWVzXG4gICAqICBidWNrZXROYW1lIF9zdHJpbmdfLFxuICAgKiAgb2JqZWN0TmFtZSBfc3RyaW5nXyAoT3B0aW9uYWwpLFxuICAgKiAgdGFncyBfb2JqZWN0XyBvZiB0aGUgZm9ybSB7Jzx0YWcta2V5LTE+JzonPHRhZy12YWx1ZS0xPicsJzx0YWcta2V5LTI+JzonPHRhZy12YWx1ZS0yPid9XG4gICAqICBwdXRPcHRzIF9vYmplY3RfIChPcHRpb25hbCkgZS5nIHt2ZXJzaW9uSWQ6XCJteS1vYmplY3QtdmVyc2lvbi1pZFwifSxcbiAgICogIGNiKGVycm9yKWAgX2Z1bmN0aW9uXyAtIGNhbGxiYWNrIGZ1bmN0aW9uIHdpdGggYGVycmAgYXMgdGhlIGVycm9yIGFyZ3VtZW50LiBgZXJyYCBpcyBudWxsIGlmIHRoZSBvcGVyYXRpb24gaXMgc3VjY2Vzc2Z1bC5cbiAgICovXG4gIHNldFRhZ2dpbmcodGFnZ2luZ1BhcmFtcykge1xuICAgIGNvbnN0IHsgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgdGFncywgcHV0T3B0cyA9IHt9LCBjYiB9ID0gdGFnZ2luZ1BhcmFtc1xuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXG4gICAgbGV0IHF1ZXJ5ID0gJ3RhZ2dpbmcnXG5cbiAgICBpZiAocHV0T3B0cyAmJiBwdXRPcHRzLnZlcnNpb25JZCkge1xuICAgICAgcXVlcnkgPSBgJHtxdWVyeX0mdmVyc2lvbklkPSR7cHV0T3B0cy52ZXJzaW9uSWR9YFxuICAgIH1cbiAgICBjb25zdCB0YWdzTGlzdCA9IFtdXG4gICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXModGFncykpIHtcbiAgICAgIHRhZ3NMaXN0LnB1c2goeyBLZXk6IGtleSwgVmFsdWU6IHZhbHVlIH0pXG4gICAgfVxuICAgIGNvbnN0IHRhZ2dpbmdDb25maWcgPSB7XG4gICAgICBUYWdnaW5nOiB7XG4gICAgICAgIFRhZ1NldDoge1xuICAgICAgICAgIFRhZzogdGFnc0xpc3QsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH1cbiAgICBjb25zdCBlbmNvZGVyID0gbmV3IFRleHRFbmNvZGVyKClcbiAgICBjb25zdCBoZWFkZXJzID0ge31cbiAgICBjb25zdCBidWlsZGVyID0gbmV3IHhtbDJqcy5CdWlsZGVyKHsgaGVhZGxlc3M6IHRydWUsIHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9IH0pXG4gICAgbGV0IHBheWxvYWQgPSBidWlsZGVyLmJ1aWxkT2JqZWN0KHRhZ2dpbmdDb25maWcpXG4gICAgcGF5bG9hZCA9IEJ1ZmZlci5mcm9tKGVuY29kZXIuZW5jb2RlKHBheWxvYWQpKVxuICAgIGhlYWRlcnNbJ0NvbnRlbnQtTUQ1J10gPSB0b01kNShwYXlsb2FkKVxuICAgIGNvbnN0IHJlcXVlc3RPcHRpb25zID0geyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5LCBoZWFkZXJzIH1cblxuICAgIGlmIChvYmplY3ROYW1lKSB7XG4gICAgICByZXF1ZXN0T3B0aW9uc1snb2JqZWN0TmFtZSddID0gb2JqZWN0TmFtZVxuICAgIH1cbiAgICBoZWFkZXJzWydDb250ZW50LU1ENSddID0gdG9NZDUocGF5bG9hZClcblxuICAgIHRoaXMubWFrZVJlcXVlc3QocmVxdWVzdE9wdGlvbnMsIHBheWxvYWQsIFsyMDBdLCAnJywgZmFsc2UsIGNiKVxuICB9XG5cbiAgLyoqIFNldCBUYWdzIG9uIGEgQnVja2V0XG4gICAqIF9fQXJndW1lbnRzX19cbiAgICogYnVja2V0TmFtZSBfc3RyaW5nX1xuICAgKiB0YWdzIF9vYmplY3RfIG9mIHRoZSBmb3JtIHsnPHRhZy1rZXktMT4nOic8dGFnLXZhbHVlLTE+JywnPHRhZy1rZXktMj4nOic8dGFnLXZhbHVlLTI+J31cbiAgICogYGNiKGVycm9yKWAgX2Z1bmN0aW9uXyAtIGNhbGxiYWNrIGZ1bmN0aW9uIHdpdGggYGVycmAgYXMgdGhlIGVycm9yIGFyZ3VtZW50LiBgZXJyYCBpcyBudWxsIGlmIHRoZSBvcGVyYXRpb24gaXMgc3VjY2Vzc2Z1bC5cbiAgICovXG4gIHNldEJ1Y2tldFRhZ2dpbmcoYnVja2V0TmFtZSwgdGFncywgY2IpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzT2JqZWN0KHRhZ3MpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCd0YWdzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cbiAgICBpZiAoT2JqZWN0LmtleXModGFncykubGVuZ3RoID4gMTApIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ21heGltdW0gdGFncyBhbGxvd2VkIGlzIDEwXCInKVxuICAgIH1cbiAgICBpZiAoIWlzRnVuY3Rpb24oY2IpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdjYWxsYmFjayBzaG91bGQgYmUgb2YgdHlwZSBcImZ1bmN0aW9uXCInKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLnNldFRhZ2dpbmcoeyBidWNrZXROYW1lLCB0YWdzLCBjYiB9KVxuICB9XG5cbiAgLyoqIFNldCBUYWdzIG9uIGFuIE9iamVjdFxuICAgKiBfX0FyZ3VtZW50c19fXG4gICAqIGJ1Y2tldE5hbWUgX3N0cmluZ19cbiAgICogb2JqZWN0TmFtZSBfc3RyaW5nX1xuICAgKiAgKiB0YWdzIF9vYmplY3RfIG9mIHRoZSBmb3JtIHsnPHRhZy1rZXktMT4nOic8dGFnLXZhbHVlLTE+JywnPHRhZy1rZXktMj4nOic8dGFnLXZhbHVlLTI+J31cbiAgICogIHB1dE9wdHMgX29iamVjdF8gKE9wdGlvbmFsKSBlLmcge3ZlcnNpb25JZDpcIm15LW9iamVjdC12ZXJzaW9uLWlkXCJ9LFxuICAgKiBgY2IoZXJyb3IpYCBfZnVuY3Rpb25fIC0gY2FsbGJhY2sgZnVuY3Rpb24gd2l0aCBgZXJyYCBhcyB0aGUgZXJyb3IgYXJndW1lbnQuIGBlcnJgIGlzIG51bGwgaWYgdGhlIG9wZXJhdGlvbiBpcyBzdWNjZXNzZnVsLlxuICAgKi9cbiAgc2V0T2JqZWN0VGFnZ2luZyhidWNrZXROYW1lLCBvYmplY3ROYW1lLCB0YWdzLCBwdXRPcHRzID0ge30sIGNiKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIG9iamVjdCBuYW1lOiAnICsgb2JqZWN0TmFtZSlcbiAgICB9XG5cbiAgICBpZiAoaXNGdW5jdGlvbihwdXRPcHRzKSkge1xuICAgICAgY2IgPSBwdXRPcHRzXG4gICAgICBwdXRPcHRzID0ge31cbiAgICB9XG5cbiAgICBpZiAoIWlzT2JqZWN0KHRhZ3MpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCd0YWdzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cbiAgICBpZiAoT2JqZWN0LmtleXModGFncykubGVuZ3RoID4gMTApIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ01heGltdW0gdGFncyBhbGxvd2VkIGlzIDEwXCInKVxuICAgIH1cblxuICAgIGlmICghaXNGdW5jdGlvbihjYikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2NhbGxiYWNrIHNob3VsZCBiZSBvZiB0eXBlIFwiZnVuY3Rpb25cIicpXG4gICAgfVxuICAgIHJldHVybiB0aGlzLnNldFRhZ2dpbmcoeyBidWNrZXROYW1lLCBvYmplY3ROYW1lLCB0YWdzLCBwdXRPcHRzLCBjYiB9KVxuICB9XG5cbiAgLyoqIFJlbW92ZSBUYWdzIG9uIGFuIEJ1Y2tldC9PYmplY3QgYmFzZWQgb24gcGFyYW1zXG4gICAqIF9fQXJndW1lbnRzX19cbiAgICogYnVja2V0TmFtZSBfc3RyaW5nX1xuICAgKiBvYmplY3ROYW1lIF9zdHJpbmdfIChvcHRpb25hbClcbiAgICogcmVtb3ZlT3B0cyBfb2JqZWN0XyAoT3B0aW9uYWwpIGUuZyB7dmVyc2lvbklkOlwibXktb2JqZWN0LXZlcnNpb24taWRcIn0sXG4gICAqIGBjYihlcnJvcilgIF9mdW5jdGlvbl8gLSBjYWxsYmFjayBmdW5jdGlvbiB3aXRoIGBlcnJgIGFzIHRoZSBlcnJvciBhcmd1bWVudC4gYGVycmAgaXMgbnVsbCBpZiB0aGUgb3BlcmF0aW9uIGlzIHN1Y2Nlc3NmdWwuXG4gICAqL1xuICByZW1vdmVUYWdnaW5nKHsgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcmVtb3ZlT3B0cywgY2IgfSkge1xuICAgIGNvbnN0IG1ldGhvZCA9ICdERUxFVEUnXG4gICAgbGV0IHF1ZXJ5ID0gJ3RhZ2dpbmcnXG5cbiAgICBpZiAocmVtb3ZlT3B0cyAmJiBPYmplY3Qua2V5cyhyZW1vdmVPcHRzKS5sZW5ndGggJiYgcmVtb3ZlT3B0cy52ZXJzaW9uSWQpIHtcbiAgICAgIHF1ZXJ5ID0gYCR7cXVlcnl9JnZlcnNpb25JZD0ke3JlbW92ZU9wdHMudmVyc2lvbklkfWBcbiAgICB9XG4gICAgY29uc3QgcmVxdWVzdE9wdGlvbnMgPSB7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnkgfVxuXG4gICAgaWYgKG9iamVjdE5hbWUpIHtcbiAgICAgIHJlcXVlc3RPcHRpb25zWydvYmplY3ROYW1lJ10gPSBvYmplY3ROYW1lXG4gICAgfVxuICAgIHRoaXMubWFrZVJlcXVlc3QocmVxdWVzdE9wdGlvbnMsICcnLCBbMjAwLCAyMDRdLCAnJywgdHJ1ZSwgY2IpXG4gIH1cblxuICAvKiogUmVtb3ZlIFRhZ3MgYXNzb2NpYXRlZCB3aXRoIGEgYnVja2V0XG4gICAqICBfX0FyZ3VtZW50c19fXG4gICAqIGJ1Y2tldE5hbWUgX3N0cmluZ19cbiAgICogYGNiKGVycm9yKWAgX2Z1bmN0aW9uXyAtIGNhbGxiYWNrIGZ1bmN0aW9uIHdpdGggYGVycmAgYXMgdGhlIGVycm9yIGFyZ3VtZW50LiBgZXJyYCBpcyBudWxsIGlmIHRoZSBvcGVyYXRpb24gaXMgc3VjY2Vzc2Z1bC5cbiAgICovXG4gIHJlbW92ZUJ1Y2tldFRhZ2dpbmcoYnVja2V0TmFtZSwgY2IpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzRnVuY3Rpb24oY2IpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdjYWxsYmFjayBzaG91bGQgYmUgb2YgdHlwZSBcImZ1bmN0aW9uXCInKVxuICAgIH1cbiAgICByZXR1cm4gdGhpcy5yZW1vdmVUYWdnaW5nKHsgYnVja2V0TmFtZSwgY2IgfSlcbiAgfVxuXG4gIC8qKiBSZW1vdmUgdGFncyBhc3NvY2lhdGVkIHdpdGggYW4gb2JqZWN0XG4gICAqIF9fQXJndW1lbnRzX19cbiAgICogYnVja2V0TmFtZSBfc3RyaW5nX1xuICAgKiBvYmplY3ROYW1lIF9zdHJpbmdfXG4gICAqIHJlbW92ZU9wdHMgX29iamVjdF8gKE9wdGlvbmFsKSBlLmcuIHtWZXJzaW9uSUQ6XCJteS1vYmplY3QtdmVyc2lvbi1pZFwifVxuICAgKiBgY2IoZXJyb3IpYCBfZnVuY3Rpb25fIC0gY2FsbGJhY2sgZnVuY3Rpb24gd2l0aCBgZXJyYCBhcyB0aGUgZXJyb3IgYXJndW1lbnQuIGBlcnJgIGlzIG51bGwgaWYgdGhlIG9wZXJhdGlvbiBpcyBzdWNjZXNzZnVsLlxuICAgKi9cbiAgcmVtb3ZlT2JqZWN0VGFnZ2luZyhidWNrZXROYW1lLCBvYmplY3ROYW1lLCByZW1vdmVPcHRzLCBjYikge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBvYmplY3QgbmFtZTogJyArIG9iamVjdE5hbWUpXG4gICAgfVxuICAgIGlmIChpc0Z1bmN0aW9uKHJlbW92ZU9wdHMpKSB7XG4gICAgICBjYiA9IHJlbW92ZU9wdHNcbiAgICAgIHJlbW92ZU9wdHMgPSB7fVxuICAgIH1cbiAgICBpZiAocmVtb3ZlT3B0cyAmJiBPYmplY3Qua2V5cyhyZW1vdmVPcHRzKS5sZW5ndGggJiYgIWlzT2JqZWN0KHJlbW92ZU9wdHMpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdyZW1vdmVPcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cblxuICAgIGlmICghaXNGdW5jdGlvbihjYikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2NhbGxiYWNrIHNob3VsZCBiZSBvZiB0eXBlIFwiZnVuY3Rpb25cIicpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMucmVtb3ZlVGFnZ2luZyh7IGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHJlbW92ZU9wdHMsIGNiIH0pXG4gIH1cblxuICAvKipcbiAgICogQXBwbHkgbGlmZWN5Y2xlIGNvbmZpZ3VyYXRpb24gb24gYSBidWNrZXQuXG4gICAqIGJ1Y2tldE5hbWUgX3N0cmluZ19cbiAgICogcG9saWN5Q29uZmlnIF9vYmplY3RfIGEgdmFsaWQgcG9saWN5IGNvbmZpZ3VyYXRpb24gb2JqZWN0LlxuICAgKiBgY2IoZXJyb3IpYCBfZnVuY3Rpb25fIC0gY2FsbGJhY2sgZnVuY3Rpb24gd2l0aCBgZXJyYCBhcyB0aGUgZXJyb3IgYXJndW1lbnQuIGBlcnJgIGlzIG51bGwgaWYgdGhlIG9wZXJhdGlvbiBpcyBzdWNjZXNzZnVsLlxuICAgKi9cbiAgYXBwbHlCdWNrZXRMaWZlY3ljbGUoYnVja2V0TmFtZSwgcG9saWN5Q29uZmlnLCBjYikge1xuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXG4gICAgY29uc3QgcXVlcnkgPSAnbGlmZWN5Y2xlJ1xuXG4gICAgY29uc3QgZW5jb2RlciA9IG5ldyBUZXh0RW5jb2RlcigpXG4gICAgY29uc3QgaGVhZGVycyA9IHt9XG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7XG4gICAgICByb290TmFtZTogJ0xpZmVjeWNsZUNvbmZpZ3VyYXRpb24nLFxuICAgICAgaGVhZGxlc3M6IHRydWUsXG4gICAgICByZW5kZXJPcHRzOiB7IHByZXR0eTogZmFsc2UgfSxcbiAgICB9KVxuICAgIGxldCBwYXlsb2FkID0gYnVpbGRlci5idWlsZE9iamVjdChwb2xpY3lDb25maWcpXG4gICAgcGF5bG9hZCA9IEJ1ZmZlci5mcm9tKGVuY29kZXIuZW5jb2RlKHBheWxvYWQpKVxuICAgIGNvbnN0IHJlcXVlc3RPcHRpb25zID0geyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5LCBoZWFkZXJzIH1cbiAgICBoZWFkZXJzWydDb250ZW50LU1ENSddID0gdG9NZDUocGF5bG9hZClcblxuICAgIHRoaXMubWFrZVJlcXVlc3QocmVxdWVzdE9wdGlvbnMsIHBheWxvYWQsIFsyMDBdLCAnJywgZmFsc2UsIGNiKVxuICB9XG5cbiAgLyoqIFJlbW92ZSBsaWZlY3ljbGUgY29uZmlndXJhdGlvbiBvZiBhIGJ1Y2tldC5cbiAgICogYnVja2V0TmFtZSBfc3RyaW5nX1xuICAgKiBgY2IoZXJyb3IpYCBfZnVuY3Rpb25fIC0gY2FsbGJhY2sgZnVuY3Rpb24gd2l0aCBgZXJyYCBhcyB0aGUgZXJyb3IgYXJndW1lbnQuIGBlcnJgIGlzIG51bGwgaWYgdGhlIG9wZXJhdGlvbiBpcyBzdWNjZXNzZnVsLlxuICAgKi9cbiAgcmVtb3ZlQnVja2V0TGlmZWN5Y2xlKGJ1Y2tldE5hbWUsIGNiKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ0RFTEVURSdcbiAgICBjb25zdCBxdWVyeSA9ICdsaWZlY3ljbGUnXG4gICAgdGhpcy5tYWtlUmVxdWVzdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSwgJycsIFsyMDRdLCAnJywgZmFsc2UsIGNiKVxuICB9XG5cbiAgLyoqIFNldC9PdmVycmlkZSBsaWZlY3ljbGUgY29uZmlndXJhdGlvbiBvbiBhIGJ1Y2tldC4gaWYgdGhlIGNvbmZpZ3VyYXRpb24gaXMgZW1wdHksIGl0IHJlbW92ZXMgdGhlIGNvbmZpZ3VyYXRpb24uXG4gICAqIGJ1Y2tldE5hbWUgX3N0cmluZ19cbiAgICogbGlmZUN5Y2xlQ29uZmlnIF9vYmplY3RfIG9uZSBvZiB0aGUgZm9sbG93aW5nIHZhbHVlczogKG51bGwgb3IgJycpIHRvIHJlbW92ZSB0aGUgbGlmZWN5Y2xlIGNvbmZpZ3VyYXRpb24uIG9yIGEgdmFsaWQgbGlmZWN5Y2xlIGNvbmZpZ3VyYXRpb25cbiAgICogYGNiKGVycm9yKWAgX2Z1bmN0aW9uXyAtIGNhbGxiYWNrIGZ1bmN0aW9uIHdpdGggYGVycmAgYXMgdGhlIGVycm9yIGFyZ3VtZW50LiBgZXJyYCBpcyBudWxsIGlmIHRoZSBvcGVyYXRpb24gaXMgc3VjY2Vzc2Z1bC5cbiAgICovXG4gIHNldEJ1Y2tldExpZmVjeWNsZShidWNrZXROYW1lLCBsaWZlQ3ljbGVDb25maWcgPSBudWxsLCBjYikge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmIChfLmlzRW1wdHkobGlmZUN5Y2xlQ29uZmlnKSkge1xuICAgICAgdGhpcy5yZW1vdmVCdWNrZXRMaWZlY3ljbGUoYnVja2V0TmFtZSwgY2IpXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuYXBwbHlCdWNrZXRMaWZlY3ljbGUoYnVja2V0TmFtZSwgbGlmZUN5Y2xlQ29uZmlnLCBjYilcbiAgICB9XG4gIH1cblxuICAvKiogR2V0IGxpZmVjeWNsZSBjb25maWd1cmF0aW9uIG9uIGEgYnVja2V0LlxuICAgKiBidWNrZXROYW1lIF9zdHJpbmdfXG4gICAqIGBjYihjb25maWcpYCBfZnVuY3Rpb25fIC0gY2FsbGJhY2sgZnVuY3Rpb24gd2l0aCBsaWZlY3ljbGUgY29uZmlndXJhdGlvbiBhcyB0aGUgZXJyb3IgYXJndW1lbnQuXG4gICAqL1xuICBnZXRCdWNrZXRMaWZlY3ljbGUoYnVja2V0TmFtZSwgY2IpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ2xpZmVjeWNsZSdcbiAgICBjb25zdCByZXF1ZXN0T3B0aW9ucyA9IHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9XG5cbiAgICB0aGlzLm1ha2VSZXF1ZXN0KHJlcXVlc3RPcHRpb25zLCAnJywgWzIwMF0sICcnLCB0cnVlLCAoZSwgcmVzcG9uc2UpID0+IHtcbiAgICAgIGNvbnN0IHRyYW5zZm9ybWVyID0gdHJhbnNmb3JtZXJzLmxpZmVjeWNsZVRyYW5zZm9ybWVyKClcbiAgICAgIGlmIChlKSB7XG4gICAgICAgIHJldHVybiBjYihlKVxuICAgICAgfVxuICAgICAgbGV0IGxpZmVjeWNsZUNvbmZpZ1xuICAgICAgcGlwZXNldHVwKHJlc3BvbnNlLCB0cmFuc2Zvcm1lcilcbiAgICAgICAgLm9uKCdkYXRhJywgKHJlc3VsdCkgPT4gKGxpZmVjeWNsZUNvbmZpZyA9IHJlc3VsdCkpXG4gICAgICAgIC5vbignZXJyb3InLCAoZSkgPT4gY2IoZSkpXG4gICAgICAgIC5vbignZW5kJywgKCkgPT4gY2IobnVsbCwgbGlmZWN5Y2xlQ29uZmlnKSlcbiAgICB9KVxuICB9XG5cbiAgZ2V0T2JqZWN0UmV0ZW50aW9uKGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGdldE9wdHMsIGNiKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc09iamVjdChnZXRPcHRzKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignY2FsbGJhY2sgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfSBlbHNlIGlmIChnZXRPcHRzLnZlcnNpb25JZCAmJiAhaXNTdHJpbmcoZ2V0T3B0cy52ZXJzaW9uSWQpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdWZXJzaW9uSUQgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmIChjYiAmJiAhaXNGdW5jdGlvbihjYikpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ2NhbGxiYWNrIHNob3VsZCBiZSBvZiB0eXBlIFwiZnVuY3Rpb25cIicpXG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgbGV0IHF1ZXJ5ID0gJ3JldGVudGlvbidcbiAgICBpZiAoZ2V0T3B0cy52ZXJzaW9uSWQpIHtcbiAgICAgIHF1ZXJ5ICs9IGAmdmVyc2lvbklkPSR7Z2V0T3B0cy52ZXJzaW9uSWR9YFxuICAgIH1cblxuICAgIHRoaXMubWFrZVJlcXVlc3QoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHF1ZXJ5IH0sICcnLCBbMjAwXSwgJycsIHRydWUsIChlLCByZXNwb25zZSkgPT4ge1xuICAgICAgaWYgKGUpIHtcbiAgICAgICAgcmV0dXJuIGNiKGUpXG4gICAgICB9XG5cbiAgICAgIGxldCByZXRlbnRpb25Db25maWcgPSBCdWZmZXIuZnJvbSgnJylcbiAgICAgIHBpcGVzZXR1cChyZXNwb25zZSwgdHJhbnNmb3JtZXJzLm9iamVjdFJldGVudGlvblRyYW5zZm9ybWVyKCkpXG4gICAgICAgIC5vbignZGF0YScsIChkYXRhKSA9PiB7XG4gICAgICAgICAgcmV0ZW50aW9uQ29uZmlnID0gZGF0YVxuICAgICAgICB9KVxuICAgICAgICAub24oJ2Vycm9yJywgY2IpXG4gICAgICAgIC5vbignZW5kJywgKCkgPT4ge1xuICAgICAgICAgIGNiKG51bGwsIHJldGVudGlvbkNvbmZpZylcbiAgICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgc2V0QnVja2V0RW5jcnlwdGlvbihidWNrZXROYW1lLCBlbmNyeXB0aW9uQ29uZmlnLCBjYikge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuXG4gICAgaWYgKGlzRnVuY3Rpb24oZW5jcnlwdGlvbkNvbmZpZykpIHtcbiAgICAgIGNiID0gZW5jcnlwdGlvbkNvbmZpZ1xuICAgICAgZW5jcnlwdGlvbkNvbmZpZyA9IG51bGxcbiAgICB9XG5cbiAgICBpZiAoIV8uaXNFbXB0eShlbmNyeXB0aW9uQ29uZmlnKSAmJiBlbmNyeXB0aW9uQ29uZmlnLlJ1bGUubGVuZ3RoID4gMSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignSW52YWxpZCBSdWxlIGxlbmd0aC4gT25seSBvbmUgcnVsZSBpcyBhbGxvd2VkLjogJyArIGVuY3J5cHRpb25Db25maWcuUnVsZSlcbiAgICB9XG4gICAgaWYgKGNiICYmICFpc0Z1bmN0aW9uKGNiKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignY2FsbGJhY2sgc2hvdWxkIGJlIG9mIHR5cGUgXCJmdW5jdGlvblwiJylcbiAgICB9XG5cbiAgICBsZXQgZW5jcnlwdGlvbk9iaiA9IGVuY3J5cHRpb25Db25maWdcbiAgICBpZiAoXy5pc0VtcHR5KGVuY3J5cHRpb25Db25maWcpKSB7XG4gICAgICBlbmNyeXB0aW9uT2JqID0ge1xuICAgICAgICAvLyBEZWZhdWx0IE1pbklPIFNlcnZlciBTdXBwb3J0ZWQgUnVsZVxuICAgICAgICBSdWxlOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgQXBwbHlTZXJ2ZXJTaWRlRW5jcnlwdGlvbkJ5RGVmYXVsdDoge1xuICAgICAgICAgICAgICBTU0VBbGdvcml0aG06ICdBRVMyNTYnLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfVxuICAgIH1cblxuICAgIGxldCBtZXRob2QgPSAnUFVUJ1xuICAgIGxldCBxdWVyeSA9ICdlbmNyeXB0aW9uJ1xuICAgIGxldCBidWlsZGVyID0gbmV3IHhtbDJqcy5CdWlsZGVyKHtcbiAgICAgIHJvb3ROYW1lOiAnU2VydmVyU2lkZUVuY3J5cHRpb25Db25maWd1cmF0aW9uJyxcbiAgICAgIHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9LFxuICAgICAgaGVhZGxlc3M6IHRydWUsXG4gICAgfSlcbiAgICBsZXQgcGF5bG9hZCA9IGJ1aWxkZXIuYnVpbGRPYmplY3QoZW5jcnlwdGlvbk9iailcblxuICAgIGNvbnN0IGhlYWRlcnMgPSB7fVxuICAgIGhlYWRlcnNbJ0NvbnRlbnQtTUQ1J10gPSB0b01kNShwYXlsb2FkKVxuXG4gICAgdGhpcy5tYWtlUmVxdWVzdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnksIGhlYWRlcnMgfSwgcGF5bG9hZCwgWzIwMF0sICcnLCBmYWxzZSwgY2IpXG4gIH1cblxuICBnZXRCdWNrZXRFbmNyeXB0aW9uKGJ1Y2tldE5hbWUsIGNiKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc0Z1bmN0aW9uKGNiKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignY2FsbGJhY2sgc2hvdWxkIGJlIG9mIHR5cGUgXCJmdW5jdGlvblwiJylcbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcbiAgICBjb25zdCBxdWVyeSA9ICdlbmNyeXB0aW9uJ1xuXG4gICAgdGhpcy5tYWtlUmVxdWVzdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSwgJycsIFsyMDBdLCAnJywgdHJ1ZSwgKGUsIHJlc3BvbnNlKSA9PiB7XG4gICAgICBpZiAoZSkge1xuICAgICAgICByZXR1cm4gY2IoZSlcbiAgICAgIH1cblxuICAgICAgbGV0IGJ1Y2tldEVuY0NvbmZpZyA9IEJ1ZmZlci5mcm9tKCcnKVxuICAgICAgcGlwZXNldHVwKHJlc3BvbnNlLCB0cmFuc2Zvcm1lcnMuYnVja2V0RW5jcnlwdGlvblRyYW5zZm9ybWVyKCkpXG4gICAgICAgIC5vbignZGF0YScsIChkYXRhKSA9PiB7XG4gICAgICAgICAgYnVja2V0RW5jQ29uZmlnID0gZGF0YVxuICAgICAgICB9KVxuICAgICAgICAub24oJ2Vycm9yJywgY2IpXG4gICAgICAgIC5vbignZW5kJywgKCkgPT4ge1xuICAgICAgICAgIGNiKG51bGwsIGJ1Y2tldEVuY0NvbmZpZylcbiAgICAgICAgfSlcbiAgICB9KVxuICB9XG4gIHJlbW92ZUJ1Y2tldEVuY3J5cHRpb24oYnVja2V0TmFtZSwgY2IpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzRnVuY3Rpb24oY2IpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdjYWxsYmFjayBzaG91bGQgYmUgb2YgdHlwZSBcImZ1bmN0aW9uXCInKVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnREVMRVRFJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ2VuY3J5cHRpb24nXG5cbiAgICB0aGlzLm1ha2VSZXF1ZXN0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9LCAnJywgWzIwNF0sICcnLCBmYWxzZSwgY2IpXG4gIH1cblxuICAvKipcbiAgICogSW50ZXJuYWwgbWV0aG9kIHRvIHVwbG9hZCBhIHBhcnQgZHVyaW5nIGNvbXBvc2Ugb2JqZWN0LlxuICAgKiBAcGFyYW0gcGFydENvbmZpZyBfX29iamVjdF9fIGNvbnRhaW5zIHRoZSBmb2xsb3dpbmcuXG4gICAqICAgIGJ1Y2tldE5hbWUgX19zdHJpbmdfX1xuICAgKiAgICBvYmplY3ROYW1lIF9fc3RyaW5nX19cbiAgICogICAgdXBsb2FkSUQgX19zdHJpbmdfX1xuICAgKiAgICBwYXJ0TnVtYmVyIF9fbnVtYmVyX19cbiAgICogICAgaGVhZGVycyBfX29iamVjdF9fXG4gICAqIEBwYXJhbSBjYiBjYWxsZWQgd2l0aCBudWxsIGluY2FzZSBvZiBlcnJvci5cbiAgICovXG4gIHVwbG9hZFBhcnRDb3B5KHBhcnRDb25maWcsIGNiKSB7XG4gICAgY29uc3QgeyBidWNrZXROYW1lLCBvYmplY3ROYW1lLCB1cGxvYWRJRCwgcGFydE51bWJlciwgaGVhZGVycyB9ID0gcGFydENvbmZpZ1xuXG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcbiAgICBsZXQgcXVlcnkgPSBgdXBsb2FkSWQ9JHt1cGxvYWRJRH0mcGFydE51bWJlcj0ke3BhcnROdW1iZXJ9YFxuICAgIGNvbnN0IHJlcXVlc3RPcHRpb25zID0geyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWU6IG9iamVjdE5hbWUsIHF1ZXJ5LCBoZWFkZXJzIH1cbiAgICByZXR1cm4gdGhpcy5tYWtlUmVxdWVzdChyZXF1ZXN0T3B0aW9ucywgJycsIFsyMDBdLCAnJywgdHJ1ZSwgKGUsIHJlc3BvbnNlKSA9PiB7XG4gICAgICBsZXQgcGFydENvcHlSZXN1bHQgPSBCdWZmZXIuZnJvbSgnJylcbiAgICAgIGlmIChlKSB7XG4gICAgICAgIHJldHVybiBjYihlKVxuICAgICAgfVxuICAgICAgcGlwZXNldHVwKHJlc3BvbnNlLCB0cmFuc2Zvcm1lcnMudXBsb2FkUGFydFRyYW5zZm9ybWVyKCkpXG4gICAgICAgIC5vbignZGF0YScsIChkYXRhKSA9PiB7XG4gICAgICAgICAgcGFydENvcHlSZXN1bHQgPSBkYXRhXG4gICAgICAgIH0pXG4gICAgICAgIC5vbignZXJyb3InLCBjYilcbiAgICAgICAgLm9uKCdlbmQnLCAoKSA9PiB7XG4gICAgICAgICAgbGV0IHVwbG9hZFBhcnRDb3B5UmVzID0ge1xuICAgICAgICAgICAgZXRhZzogc2FuaXRpemVFVGFnKHBhcnRDb3B5UmVzdWx0LkVUYWcpLFxuICAgICAgICAgICAga2V5OiBvYmplY3ROYW1lLFxuICAgICAgICAgICAgcGFydDogcGFydE51bWJlcixcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBjYihudWxsLCB1cGxvYWRQYXJ0Q29weVJlcylcbiAgICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgY29tcG9zZU9iamVjdChkZXN0T2JqQ29uZmlnID0ge30sIHNvdXJjZU9iakxpc3QgPSBbXSwgY2IpIHtcbiAgICBjb25zdCBtZSA9IHRoaXMgLy8gbWFueSBhc3luYyBmbG93cy4gc28gc3RvcmUgdGhlIHJlZi5cbiAgICBjb25zdCBzb3VyY2VGaWxlc0xlbmd0aCA9IHNvdXJjZU9iakxpc3QubGVuZ3RoXG5cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkoc291cmNlT2JqTGlzdCkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3NvdXJjZUNvbmZpZyBzaG91bGQgYW4gYXJyYXkgb2YgQ29weVNvdXJjZU9wdGlvbnMgJylcbiAgICB9XG4gICAgaWYgKCEoZGVzdE9iakNvbmZpZyBpbnN0YW5jZW9mIENvcHlEZXN0aW5hdGlvbk9wdGlvbnMpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdkZXN0Q29uZmlnIHNob3VsZCBvZiB0eXBlIENvcHlEZXN0aW5hdGlvbk9wdGlvbnMgJylcbiAgICB9XG5cbiAgICBpZiAoc291cmNlRmlsZXNMZW5ndGggPCAxIHx8IHNvdXJjZUZpbGVzTGVuZ3RoID4gUEFSVF9DT05TVFJBSU5UUy5NQVhfUEFSVFNfQ09VTlQpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoXG4gICAgICAgIGBcIlRoZXJlIG11c3QgYmUgYXMgbGVhc3Qgb25lIGFuZCB1cCB0byAke1BBUlRfQ09OU1RSQUlOVFMuTUFYX1BBUlRTX0NPVU5UfSBzb3VyY2Ugb2JqZWN0cy5gLFxuICAgICAgKVxuICAgIH1cblxuICAgIGlmICghaXNGdW5jdGlvbihjYikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2NhbGxiYWNrIHNob3VsZCBiZSBvZiB0eXBlIFwiZnVuY3Rpb25cIicpXG4gICAgfVxuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBzb3VyY2VGaWxlc0xlbmd0aDsgaSsrKSB7XG4gICAgICBpZiAoIXNvdXJjZU9iakxpc3RbaV0udmFsaWRhdGUoKSkge1xuICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIWRlc3RPYmpDb25maWcudmFsaWRhdGUoKSkge1xuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuXG4gICAgY29uc3QgZ2V0U3RhdE9wdGlvbnMgPSAoc3JjQ29uZmlnKSA9PiB7XG4gICAgICBsZXQgc3RhdE9wdHMgPSB7fVxuICAgICAgaWYgKCFfLmlzRW1wdHkoc3JjQ29uZmlnLlZlcnNpb25JRCkpIHtcbiAgICAgICAgc3RhdE9wdHMgPSB7XG4gICAgICAgICAgdmVyc2lvbklkOiBzcmNDb25maWcuVmVyc2lvbklELFxuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm4gc3RhdE9wdHNcbiAgICB9XG4gICAgY29uc3Qgc3JjT2JqZWN0U2l6ZXMgPSBbXVxuICAgIGxldCB0b3RhbFNpemUgPSAwXG4gICAgbGV0IHRvdGFsUGFydHMgPSAwXG5cbiAgICBjb25zdCBzb3VyY2VPYmpTdGF0cyA9IHNvdXJjZU9iakxpc3QubWFwKChzcmNJdGVtKSA9PlxuICAgICAgbWUuc3RhdE9iamVjdChzcmNJdGVtLkJ1Y2tldCwgc3JjSXRlbS5PYmplY3QsIGdldFN0YXRPcHRpb25zKHNyY0l0ZW0pKSxcbiAgICApXG5cbiAgICByZXR1cm4gUHJvbWlzZS5hbGwoc291cmNlT2JqU3RhdHMpXG4gICAgICAudGhlbigoc3JjT2JqZWN0SW5mb3MpID0+IHtcbiAgICAgICAgY29uc3QgdmFsaWRhdGVkU3RhdHMgPSBzcmNPYmplY3RJbmZvcy5tYXAoKHJlc0l0ZW1TdGF0LCBpbmRleCkgPT4ge1xuICAgICAgICAgIGNvbnN0IHNyY0NvbmZpZyA9IHNvdXJjZU9iakxpc3RbaW5kZXhdXG5cbiAgICAgICAgICBsZXQgc3JjQ29weVNpemUgPSByZXNJdGVtU3RhdC5zaXplXG4gICAgICAgICAgLy8gQ2hlY2sgaWYgYSBzZWdtZW50IGlzIHNwZWNpZmllZCwgYW5kIGlmIHNvLCBpcyB0aGVcbiAgICAgICAgICAvLyBzZWdtZW50IHdpdGhpbiBvYmplY3QgYm91bmRzP1xuICAgICAgICAgIGlmIChzcmNDb25maWcuTWF0Y2hSYW5nZSkge1xuICAgICAgICAgICAgLy8gU2luY2UgcmFuZ2UgaXMgc3BlY2lmaWVkLFxuICAgICAgICAgICAgLy8gICAgMCA8PSBzcmMuc3JjU3RhcnQgPD0gc3JjLnNyY0VuZFxuICAgICAgICAgICAgLy8gc28gb25seSBpbnZhbGlkIGNhc2UgdG8gY2hlY2sgaXM6XG4gICAgICAgICAgICBjb25zdCBzcmNTdGFydCA9IHNyY0NvbmZpZy5TdGFydFxuICAgICAgICAgICAgY29uc3Qgc3JjRW5kID0gc3JjQ29uZmlnLkVuZFxuICAgICAgICAgICAgaWYgKHNyY0VuZCA+PSBzcmNDb3B5U2l6ZSB8fCBzcmNTdGFydCA8IDApIHtcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihcbiAgICAgICAgICAgICAgICBgQ29weVNyY09wdGlvbnMgJHtpbmRleH0gaGFzIGludmFsaWQgc2VnbWVudC10by1jb3B5IFske3NyY1N0YXJ0fSwgJHtzcmNFbmR9XSAoc2l6ZSBpcyAke3NyY0NvcHlTaXplfSlgLFxuICAgICAgICAgICAgICApXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBzcmNDb3B5U2l6ZSA9IHNyY0VuZCAtIHNyY1N0YXJ0ICsgMVxuICAgICAgICAgIH1cblxuICAgICAgICAgIC8vIE9ubHkgdGhlIGxhc3Qgc291cmNlIG1heSBiZSBsZXNzIHRoYW4gYGFic01pblBhcnRTaXplYFxuICAgICAgICAgIGlmIChzcmNDb3B5U2l6ZSA8IFBBUlRfQ09OU1RSQUlOVFMuQUJTX01JTl9QQVJUX1NJWkUgJiYgaW5kZXggPCBzb3VyY2VGaWxlc0xlbmd0aCAtIDEpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoXG4gICAgICAgICAgICAgIGBDb3B5U3JjT3B0aW9ucyAke2luZGV4fSBpcyB0b28gc21hbGwgKCR7c3JjQ29weVNpemV9KSBhbmQgaXQgaXMgbm90IHRoZSBsYXN0IHBhcnQuYCxcbiAgICAgICAgICAgIClcbiAgICAgICAgICB9XG5cbiAgICAgICAgICAvLyBJcyBkYXRhIHRvIGNvcHkgdG9vIGxhcmdlP1xuICAgICAgICAgIHRvdGFsU2l6ZSArPSBzcmNDb3B5U2l6ZVxuICAgICAgICAgIGlmICh0b3RhbFNpemUgPiBQQVJUX0NPTlNUUkFJTlRTLk1BWF9NVUxUSVBBUlRfUFVUX09CSkVDVF9TSVpFKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBDYW5ub3QgY29tcG9zZSBhbiBvYmplY3Qgb2Ygc2l6ZSAke3RvdGFsU2l6ZX0gKD4gNVRpQilgKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIC8vIHJlY29yZCBzb3VyY2Ugc2l6ZVxuICAgICAgICAgIHNyY09iamVjdFNpemVzW2luZGV4XSA9IHNyY0NvcHlTaXplXG5cbiAgICAgICAgICAvLyBjYWxjdWxhdGUgcGFydHMgbmVlZGVkIGZvciBjdXJyZW50IHNvdXJjZVxuICAgICAgICAgIHRvdGFsUGFydHMgKz0gcGFydHNSZXF1aXJlZChzcmNDb3B5U2l6ZSlcbiAgICAgICAgICAvLyBEbyB3ZSBuZWVkIG1vcmUgcGFydHMgdGhhbiB3ZSBhcmUgYWxsb3dlZD9cbiAgICAgICAgICBpZiAodG90YWxQYXJ0cyA+IFBBUlRfQ09OU1RSQUlOVFMuTUFYX1BBUlRTX0NPVU5UKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKFxuICAgICAgICAgICAgICBgWW91ciBwcm9wb3NlZCBjb21wb3NlIG9iamVjdCByZXF1aXJlcyBtb3JlIHRoYW4gJHtQQVJUX0NPTlNUUkFJTlRTLk1BWF9QQVJUU19DT1VOVH0gcGFydHNgLFxuICAgICAgICAgICAgKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIHJldHVybiByZXNJdGVtU3RhdFxuICAgICAgICB9KVxuXG4gICAgICAgIGlmICgodG90YWxQYXJ0cyA9PT0gMSAmJiB0b3RhbFNpemUgPD0gUEFSVF9DT05TVFJBSU5UUy5NQVhfUEFSVF9TSVpFKSB8fCB0b3RhbFNpemUgPT09IDApIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy5jb3B5T2JqZWN0KHNvdXJjZU9iakxpc3RbMF0sIGRlc3RPYmpDb25maWcsIGNiKSAvLyB1c2UgY29weU9iamVjdFYyXG4gICAgICAgIH1cblxuICAgICAgICAvLyBwcmVzZXJ2ZSBldGFnIHRvIGF2b2lkIG1vZGlmaWNhdGlvbiBvZiBvYmplY3Qgd2hpbGUgY29weWluZy5cbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBzb3VyY2VGaWxlc0xlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgc291cmNlT2JqTGlzdFtpXS5NYXRjaEVUYWcgPSB2YWxpZGF0ZWRTdGF0c1tpXS5ldGFnXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBzcGxpdFBhcnRTaXplTGlzdCA9IHZhbGlkYXRlZFN0YXRzLm1hcCgocmVzSXRlbVN0YXQsIGlkeCkgPT4ge1xuICAgICAgICAgIGNvbnN0IGNhbFNpemUgPSBjYWxjdWxhdGVFdmVuU3BsaXRzKHNyY09iamVjdFNpemVzW2lkeF0sIHNvdXJjZU9iakxpc3RbaWR4XSlcbiAgICAgICAgICByZXR1cm4gY2FsU2l6ZVxuICAgICAgICB9KVxuXG4gICAgICAgIGZ1bmN0aW9uIGdldFVwbG9hZFBhcnRDb25maWdMaXN0KHVwbG9hZElkKSB7XG4gICAgICAgICAgY29uc3QgdXBsb2FkUGFydENvbmZpZ0xpc3QgPSBbXVxuXG4gICAgICAgICAgc3BsaXRQYXJ0U2l6ZUxpc3QuZm9yRWFjaCgoc3BsaXRTaXplLCBzcGxpdEluZGV4KSA9PiB7XG4gICAgICAgICAgICBjb25zdCB7IHN0YXJ0SW5kZXg6IHN0YXJ0SWR4LCBlbmRJbmRleDogZW5kSWR4LCBvYmpJbmZvOiBvYmpDb25maWcgfSA9IHNwbGl0U2l6ZVxuXG4gICAgICAgICAgICBsZXQgcGFydEluZGV4ID0gc3BsaXRJbmRleCArIDEgLy8gcGFydCBpbmRleCBzdGFydHMgZnJvbSAxLlxuICAgICAgICAgICAgY29uc3QgdG90YWxVcGxvYWRzID0gQXJyYXkuZnJvbShzdGFydElkeClcblxuICAgICAgICAgICAgY29uc3QgaGVhZGVycyA9IHNvdXJjZU9iakxpc3Rbc3BsaXRJbmRleF0uZ2V0SGVhZGVycygpXG5cbiAgICAgICAgICAgIHRvdGFsVXBsb2Fkcy5mb3JFYWNoKChzcGxpdFN0YXJ0LCB1cGxkQ3RySWR4KSA9PiB7XG4gICAgICAgICAgICAgIGxldCBzcGxpdEVuZCA9IGVuZElkeFt1cGxkQ3RySWR4XVxuXG4gICAgICAgICAgICAgIGNvbnN0IHNvdXJjZU9iaiA9IGAke29iakNvbmZpZy5CdWNrZXR9LyR7b2JqQ29uZmlnLk9iamVjdH1gXG4gICAgICAgICAgICAgIGhlYWRlcnNbJ3gtYW16LWNvcHktc291cmNlJ10gPSBgJHtzb3VyY2VPYmp9YFxuICAgICAgICAgICAgICBoZWFkZXJzWyd4LWFtei1jb3B5LXNvdXJjZS1yYW5nZSddID0gYGJ5dGVzPSR7c3BsaXRTdGFydH0tJHtzcGxpdEVuZH1gXG5cbiAgICAgICAgICAgICAgY29uc3QgdXBsb2FkUGFydENvbmZpZyA9IHtcbiAgICAgICAgICAgICAgICBidWNrZXROYW1lOiBkZXN0T2JqQ29uZmlnLkJ1Y2tldCxcbiAgICAgICAgICAgICAgICBvYmplY3ROYW1lOiBkZXN0T2JqQ29uZmlnLk9iamVjdCxcbiAgICAgICAgICAgICAgICB1cGxvYWRJRDogdXBsb2FkSWQsXG4gICAgICAgICAgICAgICAgcGFydE51bWJlcjogcGFydEluZGV4LFxuICAgICAgICAgICAgICAgIGhlYWRlcnM6IGhlYWRlcnMsXG4gICAgICAgICAgICAgICAgc291cmNlT2JqOiBzb3VyY2VPYmosXG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICB1cGxvYWRQYXJ0Q29uZmlnTGlzdC5wdXNoKHVwbG9hZFBhcnRDb25maWcpXG4gICAgICAgICAgICB9KVxuICAgICAgICAgIH0pXG5cbiAgICAgICAgICByZXR1cm4gdXBsb2FkUGFydENvbmZpZ0xpc3RcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHBlcmZvcm1VcGxvYWRQYXJ0cyA9ICh1cGxvYWRJZCkgPT4ge1xuICAgICAgICAgIGNvbnN0IHVwbG9hZExpc3QgPSBnZXRVcGxvYWRQYXJ0Q29uZmlnTGlzdCh1cGxvYWRJZClcblxuICAgICAgICAgIGFzeW5jLm1hcCh1cGxvYWRMaXN0LCBtZS51cGxvYWRQYXJ0Q29weS5iaW5kKG1lKSwgKGVyciwgcmVzKSA9PiB7XG4gICAgICAgICAgICBpZiAoZXJyKSB7XG4gICAgICAgICAgICAgIHRoaXMuYWJvcnRNdWx0aXBhcnRVcGxvYWQoZGVzdE9iakNvbmZpZy5CdWNrZXQsIGRlc3RPYmpDb25maWcuT2JqZWN0LCB1cGxvYWRJZCkudGhlbihcbiAgICAgICAgICAgICAgICAoKSA9PiBjYigpLFxuICAgICAgICAgICAgICAgIChlcnIpID0+IGNiKGVyciksXG4gICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zdCBwYXJ0c0RvbmUgPSByZXMubWFwKChwYXJ0Q29weSkgPT4gKHsgZXRhZzogcGFydENvcHkuZXRhZywgcGFydDogcGFydENvcHkucGFydCB9KSlcbiAgICAgICAgICAgIHJldHVybiBtZS5jb21wbGV0ZU11bHRpcGFydFVwbG9hZChkZXN0T2JqQ29uZmlnLkJ1Y2tldCwgZGVzdE9iakNvbmZpZy5PYmplY3QsIHVwbG9hZElkLCBwYXJ0c0RvbmUpLnRoZW4oXG4gICAgICAgICAgICAgIChyZXN1bHQpID0+IGNiKG51bGwsIHJlc3VsdCksXG4gICAgICAgICAgICAgIChlcnIpID0+IGNiKGVyciksXG4gICAgICAgICAgICApXG4gICAgICAgICAgfSlcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IG5ld1VwbG9hZEhlYWRlcnMgPSBkZXN0T2JqQ29uZmlnLmdldEhlYWRlcnMoKVxuXG4gICAgICAgIG1lLmluaXRpYXRlTmV3TXVsdGlwYXJ0VXBsb2FkKGRlc3RPYmpDb25maWcuQnVja2V0LCBkZXN0T2JqQ29uZmlnLk9iamVjdCwgbmV3VXBsb2FkSGVhZGVycykudGhlbihcbiAgICAgICAgICAodXBsb2FkSWQpID0+IHtcbiAgICAgICAgICAgIHBlcmZvcm1VcGxvYWRQYXJ0cyh1cGxvYWRJZClcbiAgICAgICAgICB9LFxuICAgICAgICAgIChlcnIpID0+IHtcbiAgICAgICAgICAgIGNiKGVyciwgbnVsbClcbiAgICAgICAgICB9LFxuICAgICAgICApXG4gICAgICB9KVxuICAgICAgLmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgICBjYihlcnJvciwgbnVsbClcbiAgICAgIH0pXG4gIH1cbiAgc2VsZWN0T2JqZWN0Q29udGVudChidWNrZXROYW1lLCBvYmplY3ROYW1lLCBzZWxlY3RPcHRzID0ge30sIGNiKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKGBJbnZhbGlkIGJ1Y2tldCBuYW1lOiAke2J1Y2tldE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFfLmlzRW1wdHkoc2VsZWN0T3B0cykpIHtcbiAgICAgIGlmICghaXNTdHJpbmcoc2VsZWN0T3B0cy5leHByZXNzaW9uKSkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdzcWxFeHByZXNzaW9uIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgICAgfVxuICAgICAgaWYgKCFfLmlzRW1wdHkoc2VsZWN0T3B0cy5pbnB1dFNlcmlhbGl6YXRpb24pKSB7XG4gICAgICAgIGlmICghaXNPYmplY3Qoc2VsZWN0T3B0cy5pbnB1dFNlcmlhbGl6YXRpb24pKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignaW5wdXRTZXJpYWxpemF0aW9uIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdpbnB1dFNlcmlhbGl6YXRpb24gaXMgcmVxdWlyZWQnKVxuICAgICAgfVxuICAgICAgaWYgKCFfLmlzRW1wdHkoc2VsZWN0T3B0cy5vdXRwdXRTZXJpYWxpemF0aW9uKSkge1xuICAgICAgICBpZiAoIWlzT2JqZWN0KHNlbGVjdE9wdHMub3V0cHV0U2VyaWFsaXphdGlvbikpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdvdXRwdXRTZXJpYWxpemF0aW9uIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdvdXRwdXRTZXJpYWxpemF0aW9uIGlzIHJlcXVpcmVkJylcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigndmFsaWQgc2VsZWN0IGNvbmZpZ3VyYXRpb24gaXMgcmVxdWlyZWQnKVxuICAgIH1cblxuICAgIGlmICghaXNGdW5jdGlvbihjYikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2NhbGxiYWNrIHNob3VsZCBiZSBvZiB0eXBlIFwiZnVuY3Rpb25cIicpXG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ1BPU1QnXG4gICAgbGV0IHF1ZXJ5ID0gYHNlbGVjdGBcbiAgICBxdWVyeSArPSAnJnNlbGVjdC10eXBlPTInXG5cbiAgICBjb25zdCBjb25maWcgPSBbXG4gICAgICB7XG4gICAgICAgIEV4cHJlc3Npb246IHNlbGVjdE9wdHMuZXhwcmVzc2lvbixcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIEV4cHJlc3Npb25UeXBlOiBzZWxlY3RPcHRzLmV4cHJlc3Npb25UeXBlIHx8ICdTUUwnLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgSW5wdXRTZXJpYWxpemF0aW9uOiBbc2VsZWN0T3B0cy5pbnB1dFNlcmlhbGl6YXRpb25dLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgT3V0cHV0U2VyaWFsaXphdGlvbjogW3NlbGVjdE9wdHMub3V0cHV0U2VyaWFsaXphdGlvbl0sXG4gICAgICB9LFxuICAgIF1cblxuICAgIC8vIE9wdGlvbmFsXG4gICAgaWYgKHNlbGVjdE9wdHMucmVxdWVzdFByb2dyZXNzKSB7XG4gICAgICBjb25maWcucHVzaCh7IFJlcXVlc3RQcm9ncmVzczogc2VsZWN0T3B0cy5yZXF1ZXN0UHJvZ3Jlc3MgfSlcbiAgICB9XG4gICAgLy8gT3B0aW9uYWxcbiAgICBpZiAoc2VsZWN0T3B0cy5zY2FuUmFuZ2UpIHtcbiAgICAgIGNvbmZpZy5wdXNoKHsgU2NhblJhbmdlOiBzZWxlY3RPcHRzLnNjYW5SYW5nZSB9KVxuICAgIH1cblxuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoe1xuICAgICAgcm9vdE5hbWU6ICdTZWxlY3RPYmplY3RDb250ZW50UmVxdWVzdCcsXG4gICAgICByZW5kZXJPcHRzOiB7IHByZXR0eTogZmFsc2UgfSxcbiAgICAgIGhlYWRsZXNzOiB0cnVlLFxuICAgIH0pXG4gICAgY29uc3QgcGF5bG9hZCA9IGJ1aWxkZXIuYnVpbGRPYmplY3QoY29uZmlnKVxuXG4gICAgdGhpcy5tYWtlUmVxdWVzdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnkgfSwgcGF5bG9hZCwgWzIwMF0sICcnLCB0cnVlLCAoZSwgcmVzcG9uc2UpID0+IHtcbiAgICAgIGlmIChlKSB7XG4gICAgICAgIHJldHVybiBjYihlKVxuICAgICAgfVxuXG4gICAgICBsZXQgc2VsZWN0UmVzdWx0XG4gICAgICBwaXBlc2V0dXAocmVzcG9uc2UsIHRyYW5zZm9ybWVycy5zZWxlY3RPYmplY3RDb250ZW50VHJhbnNmb3JtZXIoKSlcbiAgICAgICAgLm9uKCdkYXRhJywgKGRhdGEpID0+IHtcbiAgICAgICAgICBzZWxlY3RSZXN1bHQgPSBwYXJzZVNlbGVjdE9iamVjdENvbnRlbnRSZXNwb25zZShkYXRhKVxuICAgICAgICB9KVxuICAgICAgICAub24oJ2Vycm9yJywgY2IpXG4gICAgICAgIC5vbignZW5kJywgKCkgPT4ge1xuICAgICAgICAgIGNiKG51bGwsIHNlbGVjdFJlc3VsdClcbiAgICAgICAgfSlcbiAgICB9KVxuICB9XG59XG5cbi8vIFByb21pc2lmeSB2YXJpb3VzIHB1YmxpYy1mYWNpbmcgQVBJcyBvbiB0aGUgQ2xpZW50IG1vZHVsZS5cbkNsaWVudC5wcm90b3R5cGUuY29weU9iamVjdCA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLmNvcHlPYmplY3QpXG5DbGllbnQucHJvdG90eXBlLnJlbW92ZU9iamVjdHMgPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVPYmplY3RzKVxuXG5DbGllbnQucHJvdG90eXBlLnByZXNpZ25lZFVybCA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLnByZXNpZ25lZFVybClcbkNsaWVudC5wcm90b3R5cGUucHJlc2lnbmVkR2V0T2JqZWN0ID0gcHJvbWlzaWZ5KENsaWVudC5wcm90b3R5cGUucHJlc2lnbmVkR2V0T2JqZWN0KVxuQ2xpZW50LnByb3RvdHlwZS5wcmVzaWduZWRQdXRPYmplY3QgPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5wcmVzaWduZWRQdXRPYmplY3QpXG5DbGllbnQucHJvdG90eXBlLnByZXNpZ25lZFBvc3RQb2xpY3kgPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5wcmVzaWduZWRQb3N0UG9saWN5KVxuQ2xpZW50LnByb3RvdHlwZS5nZXRCdWNrZXROb3RpZmljYXRpb24gPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5nZXRCdWNrZXROb3RpZmljYXRpb24pXG5DbGllbnQucHJvdG90eXBlLnNldEJ1Y2tldE5vdGlmaWNhdGlvbiA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLnNldEJ1Y2tldE5vdGlmaWNhdGlvbilcbkNsaWVudC5wcm90b3R5cGUucmVtb3ZlQWxsQnVja2V0Tm90aWZpY2F0aW9uID0gcHJvbWlzaWZ5KENsaWVudC5wcm90b3R5cGUucmVtb3ZlQWxsQnVja2V0Tm90aWZpY2F0aW9uKVxuQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVJbmNvbXBsZXRlVXBsb2FkID0gcHJvbWlzaWZ5KENsaWVudC5wcm90b3R5cGUucmVtb3ZlSW5jb21wbGV0ZVVwbG9hZClcbkNsaWVudC5wcm90b3R5cGUuc2V0QnVja2V0VGFnZ2luZyA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLnNldEJ1Y2tldFRhZ2dpbmcpXG5DbGllbnQucHJvdG90eXBlLnJlbW92ZUJ1Y2tldFRhZ2dpbmcgPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVCdWNrZXRUYWdnaW5nKVxuQ2xpZW50LnByb3RvdHlwZS5zZXRPYmplY3RUYWdnaW5nID0gcHJvbWlzaWZ5KENsaWVudC5wcm90b3R5cGUuc2V0T2JqZWN0VGFnZ2luZylcbkNsaWVudC5wcm90b3R5cGUucmVtb3ZlT2JqZWN0VGFnZ2luZyA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLnJlbW92ZU9iamVjdFRhZ2dpbmcpXG5DbGllbnQucHJvdG90eXBlLnNldEJ1Y2tldExpZmVjeWNsZSA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLnNldEJ1Y2tldExpZmVjeWNsZSlcbkNsaWVudC5wcm90b3R5cGUuZ2V0QnVja2V0TGlmZWN5Y2xlID0gcHJvbWlzaWZ5KENsaWVudC5wcm90b3R5cGUuZ2V0QnVja2V0TGlmZWN5Y2xlKVxuQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVCdWNrZXRMaWZlY3ljbGUgPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVCdWNrZXRMaWZlY3ljbGUpXG5DbGllbnQucHJvdG90eXBlLmdldE9iamVjdFJldGVudGlvbiA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLmdldE9iamVjdFJldGVudGlvbilcbkNsaWVudC5wcm90b3R5cGUuc2V0QnVja2V0RW5jcnlwdGlvbiA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLnNldEJ1Y2tldEVuY3J5cHRpb24pXG5DbGllbnQucHJvdG90eXBlLmdldEJ1Y2tldEVuY3J5cHRpb24gPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5nZXRCdWNrZXRFbmNyeXB0aW9uKVxuQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVCdWNrZXRFbmNyeXB0aW9uID0gcHJvbWlzaWZ5KENsaWVudC5wcm90b3R5cGUucmVtb3ZlQnVja2V0RW5jcnlwdGlvbilcbkNsaWVudC5wcm90b3R5cGUuY29tcG9zZU9iamVjdCA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLmNvbXBvc2VPYmplY3QpXG5DbGllbnQucHJvdG90eXBlLnNlbGVjdE9iamVjdENvbnRlbnQgPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5zZWxlY3RPYmplY3RDb250ZW50KVxuXG4vLyByZWZhY3RvcmVkIEFQSSB1c2UgcHJvbWlzZSBpbnRlcm5hbGx5XG5DbGllbnQucHJvdG90eXBlLm1ha2VCdWNrZXQgPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLm1ha2VCdWNrZXQpXG5DbGllbnQucHJvdG90eXBlLmJ1Y2tldEV4aXN0cyA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUuYnVja2V0RXhpc3RzKVxuQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVCdWNrZXQgPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLnJlbW92ZUJ1Y2tldClcbkNsaWVudC5wcm90b3R5cGUubGlzdEJ1Y2tldHMgPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLmxpc3RCdWNrZXRzKVxuXG5DbGllbnQucHJvdG90eXBlLmdldE9iamVjdCA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUuZ2V0T2JqZWN0KVxuQ2xpZW50LnByb3RvdHlwZS5mR2V0T2JqZWN0ID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5mR2V0T2JqZWN0KVxuQ2xpZW50LnByb3RvdHlwZS5nZXRQYXJ0aWFsT2JqZWN0ID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5nZXRQYXJ0aWFsT2JqZWN0KVxuQ2xpZW50LnByb3RvdHlwZS5zdGF0T2JqZWN0ID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5zdGF0T2JqZWN0KVxuQ2xpZW50LnByb3RvdHlwZS5wdXRPYmplY3RSZXRlbnRpb24gPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLnB1dE9iamVjdFJldGVudGlvbilcbkNsaWVudC5wcm90b3R5cGUucHV0T2JqZWN0ID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5wdXRPYmplY3QpXG5DbGllbnQucHJvdG90eXBlLmZQdXRPYmplY3QgPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLmZQdXRPYmplY3QpXG5DbGllbnQucHJvdG90eXBlLnJlbW92ZU9iamVjdCA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUucmVtb3ZlT2JqZWN0KVxuXG5DbGllbnQucHJvdG90eXBlLnJlbW92ZUJ1Y2tldFJlcGxpY2F0aW9uID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVCdWNrZXRSZXBsaWNhdGlvbilcbkNsaWVudC5wcm90b3R5cGUuc2V0QnVja2V0UmVwbGljYXRpb24gPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLnNldEJ1Y2tldFJlcGxpY2F0aW9uKVxuQ2xpZW50LnByb3RvdHlwZS5nZXRCdWNrZXRSZXBsaWNhdGlvbiA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUuZ2V0QnVja2V0UmVwbGljYXRpb24pXG5DbGllbnQucHJvdG90eXBlLmdldE9iamVjdExlZ2FsSG9sZCA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUuZ2V0T2JqZWN0TGVnYWxIb2xkKVxuQ2xpZW50LnByb3RvdHlwZS5zZXRPYmplY3RMZWdhbEhvbGQgPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLnNldE9iamVjdExlZ2FsSG9sZClcbkNsaWVudC5wcm90b3R5cGUuZ2V0QnVja2V0VGFnZ2luZyA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUuZ2V0QnVja2V0VGFnZ2luZylcbkNsaWVudC5wcm90b3R5cGUuZ2V0T2JqZWN0VGFnZ2luZyA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUuZ2V0T2JqZWN0VGFnZ2luZylcbkNsaWVudC5wcm90b3R5cGUuc2V0T2JqZWN0TG9ja0NvbmZpZyA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUuc2V0T2JqZWN0TG9ja0NvbmZpZylcbkNsaWVudC5wcm90b3R5cGUuZ2V0T2JqZWN0TG9ja0NvbmZpZyA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUuZ2V0T2JqZWN0TG9ja0NvbmZpZylcbkNsaWVudC5wcm90b3R5cGUuZ2V0QnVja2V0UG9saWN5ID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5nZXRCdWNrZXRQb2xpY3kpXG5DbGllbnQucHJvdG90eXBlLnNldEJ1Y2tldFBvbGljeSA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUuc2V0QnVja2V0UG9saWN5KVxuQ2xpZW50LnByb3RvdHlwZS5nZXRCdWNrZXRWZXJzaW9uaW5nID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5nZXRCdWNrZXRWZXJzaW9uaW5nKVxuQ2xpZW50LnByb3RvdHlwZS5zZXRCdWNrZXRWZXJzaW9uaW5nID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5zZXRCdWNrZXRWZXJzaW9u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