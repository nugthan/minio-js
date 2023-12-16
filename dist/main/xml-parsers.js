"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.parseBucketEncryptionConfig = parseBucketEncryptionConfig;
exports.parseBucketNotification = parseBucketNotification;
exports.parseCopyObject = parseCopyObject;
exports.parseLifecycleConfig = parseLifecycleConfig;
exports.parseListObjects = parseListObjects;
exports.parseListObjectsV2 = parseListObjectsV2;
exports.parseListObjectsV2WithMetadata = parseListObjectsV2WithMetadata;
exports.parseObjectLegalHoldConfig = parseObjectLegalHoldConfig;
exports.parseObjectRetentionConfig = parseObjectRetentionConfig;
exports.parseSelectObjectContentResponse = parseSelectObjectContentResponse;
exports.removeObjectsParser = removeObjectsParser;
exports.uploadPartParser = uploadPartParser;
var _bufferCrc = require("buffer-crc32");
var _fastXmlParser = require("fast-xml-parser");
var errors = _interopRequireWildcard(require("./errors.js"), true);
var _helpers = require("./helpers.js");
var _helper = require("./internal/helper.js");
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

const fxpWithoutNumParser = new _fastXmlParser.XMLParser({
  numberParseOptions: {
    skipLike: /./
  }
});

// parse XML response for copy object
function parseCopyObject(xml) {
  var result = {
    etag: '',
    lastModified: ''
  };
  var xmlobj = (0, _helper.parseXml)(xml);
  if (!xmlobj.CopyObjectResult) {
    throw new errors.InvalidXMLError('Missing tag: "CopyObjectResult"');
  }
  xmlobj = xmlobj.CopyObjectResult;
  if (xmlobj.ETag) {
    result.etag = xmlobj.ETag.replace(/^"/g, '').replace(/"$/g, '').replace(/^&quot;/g, '').replace(/&quot;$/g, '').replace(/^&#34;/g, '').replace(/&#34;$/g, '');
  }
  if (xmlobj.LastModified) {
    result.lastModified = new Date(xmlobj.LastModified);
  }
  return result;
}

// parse XML response for bucket notification
function parseBucketNotification(xml) {
  var result = {
    TopicConfiguration: [],
    QueueConfiguration: [],
    CloudFunctionConfiguration: []
  };
  // Parse the events list
  var genEvents = function (events) {
    var result = [];
    if (events) {
      (0, _helper.toArray)(events).forEach(s3event => {
        result.push(s3event);
      });
    }
    return result;
  };
  // Parse all filter rules
  var genFilterRules = function (filters) {
    var result = [];
    if (filters) {
      filters = (0, _helper.toArray)(filters);
      if (filters[0].S3Key) {
        filters[0].S3Key = (0, _helper.toArray)(filters[0].S3Key);
        if (filters[0].S3Key[0].FilterRule) {
          (0, _helper.toArray)(filters[0].S3Key[0].FilterRule).forEach(rule => {
            var Name = (0, _helper.toArray)(rule.Name)[0];
            var Value = (0, _helper.toArray)(rule.Value)[0];
            result.push({
              Name,
              Value
            });
          });
        }
      }
    }
    return result;
  };
  var xmlobj = (0, _helper.parseXml)(xml);
  xmlobj = xmlobj.NotificationConfiguration;

  // Parse all topic configurations in the xml
  if (xmlobj.TopicConfiguration) {
    (0, _helper.toArray)(xmlobj.TopicConfiguration).forEach(config => {
      var Id = (0, _helper.toArray)(config.Id)[0];
      var Topic = (0, _helper.toArray)(config.Topic)[0];
      var Event = genEvents(config.Event);
      var Filter = genFilterRules(config.Filter);
      result.TopicConfiguration.push({
        Id,
        Topic,
        Event,
        Filter
      });
    });
  }
  // Parse all topic configurations in the xml
  if (xmlobj.QueueConfiguration) {
    (0, _helper.toArray)(xmlobj.QueueConfiguration).forEach(config => {
      var Id = (0, _helper.toArray)(config.Id)[0];
      var Queue = (0, _helper.toArray)(config.Queue)[0];
      var Event = genEvents(config.Event);
      var Filter = genFilterRules(config.Filter);
      result.QueueConfiguration.push({
        Id,
        Queue,
        Event,
        Filter
      });
    });
  }
  // Parse all QueueConfiguration arrays
  if (xmlobj.CloudFunctionConfiguration) {
    (0, _helper.toArray)(xmlobj.CloudFunctionConfiguration).forEach(config => {
      var Id = (0, _helper.toArray)(config.Id)[0];
      var CloudFunction = (0, _helper.toArray)(config.CloudFunction)[0];
      var Event = genEvents(config.Event);
      var Filter = genFilterRules(config.Filter);
      result.CloudFunctionConfiguration.push({
        Id,
        CloudFunction,
        Event,
        Filter
      });
    });
  }
  return result;
}
const formatObjInfo = (content, opts = {}) => {
  let {
    Key,
    LastModified,
    ETag,
    Size,
    VersionId,
    IsLatest
  } = content;
  if (!(0, _helper.isObject)(opts)) {
    opts = {};
  }
  const name = (0, _helper.sanitizeObjectKey)((0, _helper.toArray)(Key)[0]);
  const lastModified = new Date((0, _helper.toArray)(LastModified)[0]);
  const etag = (0, _helper.sanitizeETag)((0, _helper.toArray)(ETag)[0]);
  const size = (0, _helper.sanitizeSize)(Size);
  return {
    name,
    lastModified,
    etag,
    size,
    versionId: VersionId,
    isLatest: IsLatest,
    isDeleteMarker: opts.IsDeleteMarker ? opts.IsDeleteMarker : false
  };
};

// parse XML response for list objects in a bucket
function parseListObjects(xml) {
  var result = {
    objects: [],
    isTruncated: false
  };
  let isTruncated = false;
  let nextMarker, nextVersionKeyMarker;
  const xmlobj = fxpWithoutNumParser.parse(xml);
  const parseCommonPrefixesEntity = responseEntity => {
    if (responseEntity) {
      (0, _helper.toArray)(responseEntity).forEach(commonPrefix => {
        result.objects.push({
          prefix: (0, _helper.sanitizeObjectKey)((0, _helper.toArray)(commonPrefix.Prefix)[0]),
          size: 0
        });
      });
    }
  };
  const listBucketResult = xmlobj.ListBucketResult;
  const listVersionsResult = xmlobj.ListVersionsResult;
  if (listBucketResult) {
    if (listBucketResult.IsTruncated) {
      isTruncated = listBucketResult.IsTruncated;
    }
    if (listBucketResult.Contents) {
      (0, _helper.toArray)(listBucketResult.Contents).forEach(content => {
        const name = (0, _helper.sanitizeObjectKey)((0, _helper.toArray)(content.Key)[0]);
        const lastModified = new Date((0, _helper.toArray)(content.LastModified)[0]);
        const etag = (0, _helper.sanitizeETag)((0, _helper.toArray)(content.ETag)[0]);
        const size = (0, _helper.sanitizeSize)(content.Size);
        result.objects.push({
          name,
          lastModified,
          etag,
          size
        });
      });
    }
    if (listBucketResult.NextMarker) {
      nextMarker = listBucketResult.NextMarker;
    }
    parseCommonPrefixesEntity(listBucketResult.CommonPrefixes);
  }
  if (listVersionsResult) {
    if (listVersionsResult.IsTruncated) {
      isTruncated = listVersionsResult.IsTruncated;
    }
    if (listVersionsResult.Version) {
      (0, _helper.toArray)(listVersionsResult.Version).forEach(content => {
        result.objects.push(formatObjInfo(content));
      });
    }
    if (listVersionsResult.DeleteMarker) {
      (0, _helper.toArray)(listVersionsResult.DeleteMarker).forEach(content => {
        result.objects.push(formatObjInfo(content, {
          IsDeleteMarker: true
        }));
      });
    }
    if (listVersionsResult.NextKeyMarker) {
      nextVersionKeyMarker = listVersionsResult.NextKeyMarker;
    }
    if (listVersionsResult.NextVersionIdMarker) {
      result.versionIdMarker = listVersionsResult.NextVersionIdMarker;
    }
    parseCommonPrefixesEntity(listVersionsResult.CommonPrefixes);
  }
  result.isTruncated = isTruncated;
  if (isTruncated) {
    result.nextMarker = nextVersionKeyMarker || nextMarker;
  }
  return result;
}

// parse XML response for list objects v2 in a bucket
function parseListObjectsV2(xml) {
  var result = {
    objects: [],
    isTruncated: false
  };
  var xmlobj = (0, _helper.parseXml)(xml);
  if (!xmlobj.ListBucketResult) {
    throw new errors.InvalidXMLError('Missing tag: "ListBucketResult"');
  }
  xmlobj = xmlobj.ListBucketResult;
  if (xmlobj.IsTruncated) {
    result.isTruncated = xmlobj.IsTruncated;
  }
  if (xmlobj.NextContinuationToken) {
    result.nextContinuationToken = xmlobj.NextContinuationToken;
  }
  if (xmlobj.Contents) {
    (0, _helper.toArray)(xmlobj.Contents).forEach(content => {
      var name = (0, _helper.sanitizeObjectKey)((0, _helper.toArray)(content.Key)[0]);
      var lastModified = new Date(content.LastModified);
      var etag = (0, _helper.sanitizeETag)(content.ETag);
      var size = content.Size;
      result.objects.push({
        name,
        lastModified,
        etag,
        size
      });
    });
  }
  if (xmlobj.CommonPrefixes) {
    (0, _helper.toArray)(xmlobj.CommonPrefixes).forEach(commonPrefix => {
      result.objects.push({
        prefix: (0, _helper.sanitizeObjectKey)((0, _helper.toArray)(commonPrefix.Prefix)[0]),
        size: 0
      });
    });
  }
  return result;
}

// parse XML response for list objects v2 with metadata in a bucket
function parseListObjectsV2WithMetadata(xml) {
  var result = {
    objects: [],
    isTruncated: false
  };
  var xmlobj = (0, _helper.parseXml)(xml);
  if (!xmlobj.ListBucketResult) {
    throw new errors.InvalidXMLError('Missing tag: "ListBucketResult"');
  }
  xmlobj = xmlobj.ListBucketResult;
  if (xmlobj.IsTruncated) {
    result.isTruncated = xmlobj.IsTruncated;
  }
  if (xmlobj.NextContinuationToken) {
    result.nextContinuationToken = xmlobj.NextContinuationToken;
  }
  if (xmlobj.Contents) {
    (0, _helper.toArray)(xmlobj.Contents).forEach(content => {
      var name = (0, _helper.sanitizeObjectKey)(content.Key);
      var lastModified = new Date(content.LastModified);
      var etag = (0, _helper.sanitizeETag)(content.ETag);
      var size = content.Size;
      var metadata;
      if (content.UserMetadata != null) {
        metadata = (0, _helper.toArray)(content.UserMetadata)[0];
      } else {
        metadata = null;
      }
      result.objects.push({
        name,
        lastModified,
        etag,
        size,
        metadata
      });
    });
  }
  if (xmlobj.CommonPrefixes) {
    (0, _helper.toArray)(xmlobj.CommonPrefixes).forEach(commonPrefix => {
      result.objects.push({
        prefix: (0, _helper.sanitizeObjectKey)((0, _helper.toArray)(commonPrefix.Prefix)[0]),
        size: 0
      });
    });
  }
  return result;
}
function parseLifecycleConfig(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  return xmlObj.LifecycleConfiguration;
}
function parseObjectRetentionConfig(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  const retentionConfig = xmlObj.Retention;
  return {
    mode: retentionConfig.Mode,
    retainUntilDate: retentionConfig.RetainUntilDate
  };
}
function parseBucketEncryptionConfig(xml) {
  let encConfig = (0, _helper.parseXml)(xml);
  return encConfig;
}
function parseObjectLegalHoldConfig(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  return xmlObj.LegalHold;
}
function uploadPartParser(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  const respEl = xmlObj.CopyPartResult;
  return respEl;
}
function removeObjectsParser(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  if (xmlObj.DeleteResult && xmlObj.DeleteResult.Error) {
    // return errors as array always. as the response is object in case of single object passed in removeObjects
    return (0, _helper.toArray)(xmlObj.DeleteResult.Error);
  }
  return [];
}
function parseSelectObjectContentResponse(res) {
  // extractHeaderType extracts the first half of the header message, the header type.
  function extractHeaderType(stream) {
    const headerNameLen = Buffer.from(stream.read(1)).readUInt8();
    const headerNameWithSeparator = Buffer.from(stream.read(headerNameLen)).toString();
    const splitBySeparator = (headerNameWithSeparator || '').split(':');
    const headerName = splitBySeparator.length >= 1 ? splitBySeparator[1] : '';
    return headerName;
  }
  function extractHeaderValue(stream) {
    const bodyLen = Buffer.from(stream.read(2)).readUInt16BE();
    const bodyName = Buffer.from(stream.read(bodyLen)).toString();
    return bodyName;
  }
  const selectResults = new _helpers.SelectResults({}); // will be returned

  const responseStream = (0, _helper.readableStream)(res); // convert byte array to a readable responseStream
  while (responseStream._readableState.length) {
    // Top level responseStream read tracker.
    let msgCrcAccumulator; // accumulate from start of the message till the message crc start.

    const totalByteLengthBuffer = Buffer.from(responseStream.read(4));
    msgCrcAccumulator = _bufferCrc(totalByteLengthBuffer);
    const headerBytesBuffer = Buffer.from(responseStream.read(4));
    msgCrcAccumulator = _bufferCrc(headerBytesBuffer, msgCrcAccumulator);
    const calculatedPreludeCrc = msgCrcAccumulator.readInt32BE(); // use it to check if any CRC mismatch in header itself.

    const preludeCrcBuffer = Buffer.from(responseStream.read(4)); // read 4 bytes    i.e 4+4 =8 + 4 = 12 ( prelude + prelude crc)
    msgCrcAccumulator = _bufferCrc(preludeCrcBuffer, msgCrcAccumulator);
    const totalMsgLength = totalByteLengthBuffer.readInt32BE();
    const headerLength = headerBytesBuffer.readInt32BE();
    const preludeCrcByteValue = preludeCrcBuffer.readInt32BE();
    if (preludeCrcByteValue !== calculatedPreludeCrc) {
      // Handle Header CRC mismatch Error
      throw new Error(`Header Checksum Mismatch, Prelude CRC of ${preludeCrcByteValue} does not equal expected CRC of ${calculatedPreludeCrc}`);
    }
    const headers = {};
    if (headerLength > 0) {
      const headerBytes = Buffer.from(responseStream.read(headerLength));
      msgCrcAccumulator = _bufferCrc(headerBytes, msgCrcAccumulator);
      const headerReaderStream = (0, _helper.readableStream)(headerBytes);
      while (headerReaderStream._readableState.length) {
        let headerTypeName = extractHeaderType(headerReaderStream);
        headerReaderStream.read(1); // just read and ignore it.
        headers[headerTypeName] = extractHeaderValue(headerReaderStream);
      }
    }
    let payloadStream;
    const payLoadLength = totalMsgLength - headerLength - 16;
    if (payLoadLength > 0) {
      const payLoadBuffer = Buffer.from(responseStream.read(payLoadLength));
      msgCrcAccumulator = _bufferCrc(payLoadBuffer, msgCrcAccumulator);
      // read the checksum early and detect any mismatch so we can avoid unnecessary further processing.
      const messageCrcByteValue = Buffer.from(responseStream.read(4)).readInt32BE();
      const calculatedCrc = msgCrcAccumulator.readInt32BE();
      // Handle message CRC Error
      if (messageCrcByteValue !== calculatedCrc) {
        throw new Error(`Message Checksum Mismatch, Message CRC of ${messageCrcByteValue} does not equal expected CRC of ${calculatedCrc}`);
      }
      payloadStream = (0, _helper.readableStream)(payLoadBuffer);
    }
    const messageType = headers['message-type'];
    switch (messageType) {
      case 'error':
        {
          const errorMessage = headers['error-code'] + ':"' + headers['error-message'] + '"';
          throw new Error(errorMessage);
        }
      case 'event':
        {
          const contentType = headers['content-type'];
          const eventType = headers['event-type'];
          switch (eventType) {
            case 'End':
              {
                selectResults.setResponse(res);
                return selectResults;
              }
            case 'Records':
              {
                const readData = payloadStream.read(payLoadLength);
                selectResults.setRecords(readData);
                break;
              }
            case 'Progress':
              {
                switch (contentType) {
                  case 'text/xml':
                    {
                      const progressData = payloadStream.read(payLoadLength);
                      selectResults.setProgress(progressData.toString());
                      break;
                    }
                  default:
                    {
                      const errorMessage = `Unexpected content-type ${contentType} sent for event-type Progress`;
                      throw new Error(errorMessage);
                    }
                }
              }
              break;
            case 'Stats':
              {
                switch (contentType) {
                  case 'text/xml':
                    {
                      const statsData = payloadStream.read(payLoadLength);
                      selectResults.setStats(statsData.toString());
                      break;
                    }
                  default:
                    {
                      const errorMessage = `Unexpected content-type ${contentType} sent for event-type Stats`;
                      throw new Error(errorMessage);
                    }
                }
              }
              break;
            default:
              {
                // Continuation message: Not sure if it is supported. did not find a reference or any message in response.
                // It does not have a payload.
                const warningMessage = `Un implemented event detected  ${messageType}.`;
                // eslint-disable-next-line no-console
                console.warn(warningMessage);
              }
          } // eventType End
        }
      // Event End
    } // messageType End
  } // Top Level Stream End
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfYnVmZmVyQ3JjIiwicmVxdWlyZSIsIl9mYXN0WG1sUGFyc2VyIiwiZXJyb3JzIiwiX2ludGVyb3BSZXF1aXJlV2lsZGNhcmQiLCJfaGVscGVycyIsIl9oZWxwZXIiLCJfZ2V0UmVxdWlyZVdpbGRjYXJkQ2FjaGUiLCJub2RlSW50ZXJvcCIsIldlYWtNYXAiLCJjYWNoZUJhYmVsSW50ZXJvcCIsImNhY2hlTm9kZUludGVyb3AiLCJvYmoiLCJfX2VzTW9kdWxlIiwiZGVmYXVsdCIsImNhY2hlIiwiaGFzIiwiZ2V0IiwibmV3T2JqIiwiaGFzUHJvcGVydHlEZXNjcmlwdG9yIiwiT2JqZWN0IiwiZGVmaW5lUHJvcGVydHkiLCJnZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IiLCJrZXkiLCJwcm90b3R5cGUiLCJoYXNPd25Qcm9wZXJ0eSIsImNhbGwiLCJkZXNjIiwic2V0IiwiZnhwV2l0aG91dE51bVBhcnNlciIsIlhNTFBhcnNlciIsIm51bWJlclBhcnNlT3B0aW9ucyIsInNraXBMaWtlIiwicGFyc2VDb3B5T2JqZWN0IiwieG1sIiwicmVzdWx0IiwiZXRhZyIsImxhc3RNb2RpZmllZCIsInhtbG9iaiIsInBhcnNlWG1sIiwiQ29weU9iamVjdFJlc3VsdCIsIkludmFsaWRYTUxFcnJvciIsIkVUYWciLCJyZXBsYWNlIiwiTGFzdE1vZGlmaWVkIiwiRGF0ZSIsInBhcnNlQnVja2V0Tm90aWZpY2F0aW9uIiwiVG9waWNDb25maWd1cmF0aW9uIiwiUXVldWVDb25maWd1cmF0aW9uIiwiQ2xvdWRGdW5jdGlvbkNvbmZpZ3VyYXRpb24iLCJnZW5FdmVudHMiLCJldmVudHMiLCJ0b0FycmF5IiwiZm9yRWFjaCIsInMzZXZlbnQiLCJwdXNoIiwiZ2VuRmlsdGVyUnVsZXMiLCJmaWx0ZXJzIiwiUzNLZXkiLCJGaWx0ZXJSdWxlIiwicnVsZSIsIk5hbWUiLCJWYWx1ZSIsIk5vdGlmaWNhdGlvbkNvbmZpZ3VyYXRpb24iLCJjb25maWciLCJJZCIsIlRvcGljIiwiRXZlbnQiLCJGaWx0ZXIiLCJRdWV1ZSIsIkNsb3VkRnVuY3Rpb24iLCJmb3JtYXRPYmpJbmZvIiwiY29udGVudCIsIm9wdHMiLCJLZXkiLCJTaXplIiwiVmVyc2lvbklkIiwiSXNMYXRlc3QiLCJpc09iamVjdCIsIm5hbWUiLCJzYW5pdGl6ZU9iamVjdEtleSIsInNhbml0aXplRVRhZyIsInNpemUiLCJzYW5pdGl6ZVNpemUiLCJ2ZXJzaW9uSWQiLCJpc0xhdGVzdCIsImlzRGVsZXRlTWFya2VyIiwiSXNEZWxldGVNYXJrZXIiLCJwYXJzZUxpc3RPYmplY3RzIiwib2JqZWN0cyIsImlzVHJ1bmNhdGVkIiwibmV4dE1hcmtlciIsIm5leHRWZXJzaW9uS2V5TWFya2VyIiwicGFyc2UiLCJwYXJzZUNvbW1vblByZWZpeGVzRW50aXR5IiwicmVzcG9uc2VFbnRpdHkiLCJjb21tb25QcmVmaXgiLCJwcmVmaXgiLCJQcmVmaXgiLCJsaXN0QnVja2V0UmVzdWx0IiwiTGlzdEJ1Y2tldFJlc3VsdCIsImxpc3RWZXJzaW9uc1Jlc3VsdCIsIkxpc3RWZXJzaW9uc1Jlc3VsdCIsIklzVHJ1bmNhdGVkIiwiQ29udGVudHMiLCJOZXh0TWFya2VyIiwiQ29tbW9uUHJlZml4ZXMiLCJWZXJzaW9uIiwiRGVsZXRlTWFya2VyIiwiTmV4dEtleU1hcmtlciIsIk5leHRWZXJzaW9uSWRNYXJrZXIiLCJ2ZXJzaW9uSWRNYXJrZXIiLCJwYXJzZUxpc3RPYmplY3RzVjIiLCJOZXh0Q29udGludWF0aW9uVG9rZW4iLCJuZXh0Q29udGludWF0aW9uVG9rZW4iLCJwYXJzZUxpc3RPYmplY3RzVjJXaXRoTWV0YWRhdGEiLCJtZXRhZGF0YSIsIlVzZXJNZXRhZGF0YSIsInBhcnNlTGlmZWN5Y2xlQ29uZmlnIiwieG1sT2JqIiwiTGlmZWN5Y2xlQ29uZmlndXJhdGlvbiIsInBhcnNlT2JqZWN0UmV0ZW50aW9uQ29uZmlnIiwicmV0ZW50aW9uQ29uZmlnIiwiUmV0ZW50aW9uIiwibW9kZSIsIk1vZGUiLCJyZXRhaW5VbnRpbERhdGUiLCJSZXRhaW5VbnRpbERhdGUiLCJwYXJzZUJ1Y2tldEVuY3J5cHRpb25Db25maWciLCJlbmNDb25maWciLCJwYXJzZU9iamVjdExlZ2FsSG9sZENvbmZpZyIsIkxlZ2FsSG9sZCIsInVwbG9hZFBhcnRQYXJzZXIiLCJyZXNwRWwiLCJDb3B5UGFydFJlc3VsdCIsInJlbW92ZU9iamVjdHNQYXJzZXIiLCJEZWxldGVSZXN1bHQiLCJFcnJvciIsInBhcnNlU2VsZWN0T2JqZWN0Q29udGVudFJlc3BvbnNlIiwicmVzIiwiZXh0cmFjdEhlYWRlclR5cGUiLCJzdHJlYW0iLCJoZWFkZXJOYW1lTGVuIiwiQnVmZmVyIiwiZnJvbSIsInJlYWQiLCJyZWFkVUludDgiLCJoZWFkZXJOYW1lV2l0aFNlcGFyYXRvciIsInRvU3RyaW5nIiwic3BsaXRCeVNlcGFyYXRvciIsInNwbGl0IiwiaGVhZGVyTmFtZSIsImxlbmd0aCIsImV4dHJhY3RIZWFkZXJWYWx1ZSIsImJvZHlMZW4iLCJyZWFkVUludDE2QkUiLCJib2R5TmFtZSIsInNlbGVjdFJlc3VsdHMiLCJTZWxlY3RSZXN1bHRzIiwicmVzcG9uc2VTdHJlYW0iLCJyZWFkYWJsZVN0cmVhbSIsIl9yZWFkYWJsZVN0YXRlIiwibXNnQ3JjQWNjdW11bGF0b3IiLCJ0b3RhbEJ5dGVMZW5ndGhCdWZmZXIiLCJjcmMzMiIsImhlYWRlckJ5dGVzQnVmZmVyIiwiY2FsY3VsYXRlZFByZWx1ZGVDcmMiLCJyZWFkSW50MzJCRSIsInByZWx1ZGVDcmNCdWZmZXIiLCJ0b3RhbE1zZ0xlbmd0aCIsImhlYWRlckxlbmd0aCIsInByZWx1ZGVDcmNCeXRlVmFsdWUiLCJoZWFkZXJzIiwiaGVhZGVyQnl0ZXMiLCJoZWFkZXJSZWFkZXJTdHJlYW0iLCJoZWFkZXJUeXBlTmFtZSIsInBheWxvYWRTdHJlYW0iLCJwYXlMb2FkTGVuZ3RoIiwicGF5TG9hZEJ1ZmZlciIsIm1lc3NhZ2VDcmNCeXRlVmFsdWUiLCJjYWxjdWxhdGVkQ3JjIiwibWVzc2FnZVR5cGUiLCJlcnJvck1lc3NhZ2UiLCJjb250ZW50VHlwZSIsImV2ZW50VHlwZSIsInNldFJlc3BvbnNlIiwicmVhZERhdGEiLCJzZXRSZWNvcmRzIiwicHJvZ3Jlc3NEYXRhIiwic2V0UHJvZ3Jlc3MiLCJzdGF0c0RhdGEiLCJzZXRTdGF0cyIsIndhcm5pbmdNZXNzYWdlIiwiY29uc29sZSIsIndhcm4iXSwic291cmNlcyI6WyJ4bWwtcGFyc2Vycy5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKlxuICogTWluSU8gSmF2YXNjcmlwdCBMaWJyYXJ5IGZvciBBbWF6b24gUzMgQ29tcGF0aWJsZSBDbG91ZCBTdG9yYWdlLCAoQykgMjAxNSBNaW5JTywgSW5jLlxuICpcbiAqIExpY2Vuc2VkIHVuZGVyIHRoZSBBcGFjaGUgTGljZW5zZSwgVmVyc2lvbiAyLjAgKHRoZSBcIkxpY2Vuc2VcIik7XG4gKiB5b3UgbWF5IG5vdCB1c2UgdGhpcyBmaWxlIGV4Y2VwdCBpbiBjb21wbGlhbmNlIHdpdGggdGhlIExpY2Vuc2UuXG4gKiBZb3UgbWF5IG9idGFpbiBhIGNvcHkgb2YgdGhlIExpY2Vuc2UgYXRcbiAqXG4gKiAgICAgaHR0cDovL3d3dy5hcGFjaGUub3JnL2xpY2Vuc2VzL0xJQ0VOU0UtMi4wXG4gKlxuICogVW5sZXNzIHJlcXVpcmVkIGJ5IGFwcGxpY2FibGUgbGF3IG9yIGFncmVlZCB0byBpbiB3cml0aW5nLCBzb2Z0d2FyZVxuICogZGlzdHJpYnV0ZWQgdW5kZXIgdGhlIExpY2Vuc2UgaXMgZGlzdHJpYnV0ZWQgb24gYW4gXCJBUyBJU1wiIEJBU0lTLFxuICogV0lUSE9VVCBXQVJSQU5USUVTIE9SIENPTkRJVElPTlMgT0YgQU5ZIEtJTkQsIGVpdGhlciBleHByZXNzIG9yIGltcGxpZWQuXG4gKiBTZWUgdGhlIExpY2Vuc2UgZm9yIHRoZSBzcGVjaWZpYyBsYW5ndWFnZSBnb3Zlcm5pbmcgcGVybWlzc2lvbnMgYW5kXG4gKiBsaW1pdGF0aW9ucyB1bmRlciB0aGUgTGljZW5zZS5cbiAqL1xuXG5pbXBvcnQgY3JjMzIgZnJvbSAnYnVmZmVyLWNyYzMyJ1xuaW1wb3J0IHsgWE1MUGFyc2VyIH0gZnJvbSAnZmFzdC14bWwtcGFyc2VyJ1xuXG5pbXBvcnQgKiBhcyBlcnJvcnMgZnJvbSAnLi9lcnJvcnMudHMnXG5pbXBvcnQgeyBTZWxlY3RSZXN1bHRzIH0gZnJvbSAnLi9oZWxwZXJzLnRzJ1xuaW1wb3J0IHtcbiAgaXNPYmplY3QsXG4gIHBhcnNlWG1sLFxuICByZWFkYWJsZVN0cmVhbSxcbiAgc2FuaXRpemVFVGFnLFxuICBzYW5pdGl6ZU9iamVjdEtleSxcbiAgc2FuaXRpemVTaXplLFxuICB0b0FycmF5LFxufSBmcm9tICcuL2ludGVybmFsL2hlbHBlci50cydcblxuY29uc3QgZnhwV2l0aG91dE51bVBhcnNlciA9IG5ldyBYTUxQYXJzZXIoe1xuICBudW1iZXJQYXJzZU9wdGlvbnM6IHtcbiAgICBza2lwTGlrZTogLy4vLFxuICB9LFxufSlcblxuLy8gcGFyc2UgWE1MIHJlc3BvbnNlIGZvciBjb3B5IG9iamVjdFxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlQ29weU9iamVjdCh4bWwpIHtcbiAgdmFyIHJlc3VsdCA9IHtcbiAgICBldGFnOiAnJyxcbiAgICBsYXN0TW9kaWZpZWQ6ICcnLFxuICB9XG5cbiAgdmFyIHhtbG9iaiA9IHBhcnNlWG1sKHhtbClcbiAgaWYgKCF4bWxvYmouQ29weU9iamVjdFJlc3VsdCkge1xuICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZFhNTEVycm9yKCdNaXNzaW5nIHRhZzogXCJDb3B5T2JqZWN0UmVzdWx0XCInKVxuICB9XG4gIHhtbG9iaiA9IHhtbG9iai5Db3B5T2JqZWN0UmVzdWx0XG4gIGlmICh4bWxvYmouRVRhZykge1xuICAgIHJlc3VsdC5ldGFnID0geG1sb2JqLkVUYWcucmVwbGFjZSgvXlwiL2csICcnKVxuICAgICAgLnJlcGxhY2UoL1wiJC9nLCAnJylcbiAgICAgIC5yZXBsYWNlKC9eJnF1b3Q7L2csICcnKVxuICAgICAgLnJlcGxhY2UoLyZxdW90OyQvZywgJycpXG4gICAgICAucmVwbGFjZSgvXiYjMzQ7L2csICcnKVxuICAgICAgLnJlcGxhY2UoLyYjMzQ7JC9nLCAnJylcbiAgfVxuICBpZiAoeG1sb2JqLkxhc3RNb2RpZmllZCkge1xuICAgIHJlc3VsdC5sYXN0TW9kaWZpZWQgPSBuZXcgRGF0ZSh4bWxvYmouTGFzdE1vZGlmaWVkKVxuICB9XG5cbiAgcmV0dXJuIHJlc3VsdFxufVxuXG4vLyBwYXJzZSBYTUwgcmVzcG9uc2UgZm9yIGJ1Y2tldCBub3RpZmljYXRpb25cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUJ1Y2tldE5vdGlmaWNhdGlvbih4bWwpIHtcbiAgdmFyIHJlc3VsdCA9IHtcbiAgICBUb3BpY0NvbmZpZ3VyYXRpb246IFtdLFxuICAgIFF1ZXVlQ29uZmlndXJhdGlvbjogW10sXG4gICAgQ2xvdWRGdW5jdGlvbkNvbmZpZ3VyYXRpb246IFtdLFxuICB9XG4gIC8vIFBhcnNlIHRoZSBldmVudHMgbGlzdFxuICB2YXIgZ2VuRXZlbnRzID0gZnVuY3Rpb24gKGV2ZW50cykge1xuICAgIHZhciByZXN1bHQgPSBbXVxuICAgIGlmIChldmVudHMpIHtcbiAgICAgIHRvQXJyYXkoZXZlbnRzKS5mb3JFYWNoKChzM2V2ZW50KSA9PiB7XG4gICAgICAgIHJlc3VsdC5wdXNoKHMzZXZlbnQpXG4gICAgICB9KVxuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0XG4gIH1cbiAgLy8gUGFyc2UgYWxsIGZpbHRlciBydWxlc1xuICB2YXIgZ2VuRmlsdGVyUnVsZXMgPSBmdW5jdGlvbiAoZmlsdGVycykge1xuICAgIHZhciByZXN1bHQgPSBbXVxuICAgIGlmIChmaWx0ZXJzKSB7XG4gICAgICBmaWx0ZXJzID0gdG9BcnJheShmaWx0ZXJzKVxuICAgICAgaWYgKGZpbHRlcnNbMF0uUzNLZXkpIHtcbiAgICAgICAgZmlsdGVyc1swXS5TM0tleSA9IHRvQXJyYXkoZmlsdGVyc1swXS5TM0tleSlcbiAgICAgICAgaWYgKGZpbHRlcnNbMF0uUzNLZXlbMF0uRmlsdGVyUnVsZSkge1xuICAgICAgICAgIHRvQXJyYXkoZmlsdGVyc1swXS5TM0tleVswXS5GaWx0ZXJSdWxlKS5mb3JFYWNoKChydWxlKSA9PiB7XG4gICAgICAgICAgICB2YXIgTmFtZSA9IHRvQXJyYXkocnVsZS5OYW1lKVswXVxuICAgICAgICAgICAgdmFyIFZhbHVlID0gdG9BcnJheShydWxlLlZhbHVlKVswXVxuICAgICAgICAgICAgcmVzdWx0LnB1c2goeyBOYW1lLCBWYWx1ZSB9KVxuICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdFxuICB9XG5cbiAgdmFyIHhtbG9iaiA9IHBhcnNlWG1sKHhtbClcbiAgeG1sb2JqID0geG1sb2JqLk5vdGlmaWNhdGlvbkNvbmZpZ3VyYXRpb25cblxuICAvLyBQYXJzZSBhbGwgdG9waWMgY29uZmlndXJhdGlvbnMgaW4gdGhlIHhtbFxuICBpZiAoeG1sb2JqLlRvcGljQ29uZmlndXJhdGlvbikge1xuICAgIHRvQXJyYXkoeG1sb2JqLlRvcGljQ29uZmlndXJhdGlvbikuZm9yRWFjaCgoY29uZmlnKSA9PiB7XG4gICAgICB2YXIgSWQgPSB0b0FycmF5KGNvbmZpZy5JZClbMF1cbiAgICAgIHZhciBUb3BpYyA9IHRvQXJyYXkoY29uZmlnLlRvcGljKVswXVxuICAgICAgdmFyIEV2ZW50ID0gZ2VuRXZlbnRzKGNvbmZpZy5FdmVudClcbiAgICAgIHZhciBGaWx0ZXIgPSBnZW5GaWx0ZXJSdWxlcyhjb25maWcuRmlsdGVyKVxuICAgICAgcmVzdWx0LlRvcGljQ29uZmlndXJhdGlvbi5wdXNoKHsgSWQsIFRvcGljLCBFdmVudCwgRmlsdGVyIH0pXG4gICAgfSlcbiAgfVxuICAvLyBQYXJzZSBhbGwgdG9waWMgY29uZmlndXJhdGlvbnMgaW4gdGhlIHhtbFxuICBpZiAoeG1sb2JqLlF1ZXVlQ29uZmlndXJhdGlvbikge1xuICAgIHRvQXJyYXkoeG1sb2JqLlF1ZXVlQ29uZmlndXJhdGlvbikuZm9yRWFjaCgoY29uZmlnKSA9PiB7XG4gICAgICB2YXIgSWQgPSB0b0FycmF5KGNvbmZpZy5JZClbMF1cbiAgICAgIHZhciBRdWV1ZSA9IHRvQXJyYXkoY29uZmlnLlF1ZXVlKVswXVxuICAgICAgdmFyIEV2ZW50ID0gZ2VuRXZlbnRzKGNvbmZpZy5FdmVudClcbiAgICAgIHZhciBGaWx0ZXIgPSBnZW5GaWx0ZXJSdWxlcyhjb25maWcuRmlsdGVyKVxuICAgICAgcmVzdWx0LlF1ZXVlQ29uZmlndXJhdGlvbi5wdXNoKHsgSWQsIFF1ZXVlLCBFdmVudCwgRmlsdGVyIH0pXG4gICAgfSlcbiAgfVxuICAvLyBQYXJzZSBhbGwgUXVldWVDb25maWd1cmF0aW9uIGFycmF5c1xuICBpZiAoeG1sb2JqLkNsb3VkRnVuY3Rpb25Db25maWd1cmF0aW9uKSB7XG4gICAgdG9BcnJheSh4bWxvYmouQ2xvdWRGdW5jdGlvbkNvbmZpZ3VyYXRpb24pLmZvckVhY2goKGNvbmZpZykgPT4ge1xuICAgICAgdmFyIElkID0gdG9BcnJheShjb25maWcuSWQpWzBdXG4gICAgICB2YXIgQ2xvdWRGdW5jdGlvbiA9IHRvQXJyYXkoY29uZmlnLkNsb3VkRnVuY3Rpb24pWzBdXG4gICAgICB2YXIgRXZlbnQgPSBnZW5FdmVudHMoY29uZmlnLkV2ZW50KVxuICAgICAgdmFyIEZpbHRlciA9IGdlbkZpbHRlclJ1bGVzKGNvbmZpZy5GaWx0ZXIpXG4gICAgICByZXN1bHQuQ2xvdWRGdW5jdGlvbkNvbmZpZ3VyYXRpb24ucHVzaCh7IElkLCBDbG91ZEZ1bmN0aW9uLCBFdmVudCwgRmlsdGVyIH0pXG4gICAgfSlcbiAgfVxuXG4gIHJldHVybiByZXN1bHRcbn1cblxuY29uc3QgZm9ybWF0T2JqSW5mbyA9IChjb250ZW50LCBvcHRzID0ge30pID0+IHtcbiAgbGV0IHsgS2V5LCBMYXN0TW9kaWZpZWQsIEVUYWcsIFNpemUsIFZlcnNpb25JZCwgSXNMYXRlc3QgfSA9IGNvbnRlbnRcblxuICBpZiAoIWlzT2JqZWN0KG9wdHMpKSB7XG4gICAgb3B0cyA9IHt9XG4gIH1cblxuICBjb25zdCBuYW1lID0gc2FuaXRpemVPYmplY3RLZXkodG9BcnJheShLZXkpWzBdKVxuICBjb25zdCBsYXN0TW9kaWZpZWQgPSBuZXcgRGF0ZSh0b0FycmF5KExhc3RNb2RpZmllZClbMF0pXG4gIGNvbnN0IGV0YWcgPSBzYW5pdGl6ZUVUYWcodG9BcnJheShFVGFnKVswXSlcbiAgY29uc3Qgc2l6ZSA9IHNhbml0aXplU2l6ZShTaXplKVxuXG4gIHJldHVybiB7XG4gICAgbmFtZSxcbiAgICBsYXN0TW9kaWZpZWQsXG4gICAgZXRhZyxcbiAgICBzaXplLFxuICAgIHZlcnNpb25JZDogVmVyc2lvbklkLFxuICAgIGlzTGF0ZXN0OiBJc0xhdGVzdCxcbiAgICBpc0RlbGV0ZU1hcmtlcjogb3B0cy5Jc0RlbGV0ZU1hcmtlciA/IG9wdHMuSXNEZWxldGVNYXJrZXIgOiBmYWxzZSxcbiAgfVxufVxuXG4vLyBwYXJzZSBYTUwgcmVzcG9uc2UgZm9yIGxpc3Qgb2JqZWN0cyBpbiBhIGJ1Y2tldFxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlTGlzdE9iamVjdHMoeG1sKSB7XG4gIHZhciByZXN1bHQgPSB7XG4gICAgb2JqZWN0czogW10sXG4gICAgaXNUcnVuY2F0ZWQ6IGZhbHNlLFxuICB9XG4gIGxldCBpc1RydW5jYXRlZCA9IGZhbHNlXG4gIGxldCBuZXh0TWFya2VyLCBuZXh0VmVyc2lvbktleU1hcmtlclxuICBjb25zdCB4bWxvYmogPSBmeHBXaXRob3V0TnVtUGFyc2VyLnBhcnNlKHhtbClcblxuICBjb25zdCBwYXJzZUNvbW1vblByZWZpeGVzRW50aXR5ID0gKHJlc3BvbnNlRW50aXR5KSA9PiB7XG4gICAgaWYgKHJlc3BvbnNlRW50aXR5KSB7XG4gICAgICB0b0FycmF5KHJlc3BvbnNlRW50aXR5KS5mb3JFYWNoKChjb21tb25QcmVmaXgpID0+IHtcbiAgICAgICAgcmVzdWx0Lm9iamVjdHMucHVzaCh7IHByZWZpeDogc2FuaXRpemVPYmplY3RLZXkodG9BcnJheShjb21tb25QcmVmaXguUHJlZml4KVswXSksIHNpemU6IDAgfSlcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgY29uc3QgbGlzdEJ1Y2tldFJlc3VsdCA9IHhtbG9iai5MaXN0QnVja2V0UmVzdWx0XG4gIGNvbnN0IGxpc3RWZXJzaW9uc1Jlc3VsdCA9IHhtbG9iai5MaXN0VmVyc2lvbnNSZXN1bHRcblxuICBpZiAobGlzdEJ1Y2tldFJlc3VsdCkge1xuICAgIGlmIChsaXN0QnVja2V0UmVzdWx0LklzVHJ1bmNhdGVkKSB7XG4gICAgICBpc1RydW5jYXRlZCA9IGxpc3RCdWNrZXRSZXN1bHQuSXNUcnVuY2F0ZWRcbiAgICB9XG4gICAgaWYgKGxpc3RCdWNrZXRSZXN1bHQuQ29udGVudHMpIHtcbiAgICAgIHRvQXJyYXkobGlzdEJ1Y2tldFJlc3VsdC5Db250ZW50cykuZm9yRWFjaCgoY29udGVudCkgPT4ge1xuICAgICAgICBjb25zdCBuYW1lID0gc2FuaXRpemVPYmplY3RLZXkodG9BcnJheShjb250ZW50LktleSlbMF0pXG4gICAgICAgIGNvbnN0IGxhc3RNb2RpZmllZCA9IG5ldyBEYXRlKHRvQXJyYXkoY29udGVudC5MYXN0TW9kaWZpZWQpWzBdKVxuICAgICAgICBjb25zdCBldGFnID0gc2FuaXRpemVFVGFnKHRvQXJyYXkoY29udGVudC5FVGFnKVswXSlcbiAgICAgICAgY29uc3Qgc2l6ZSA9IHNhbml0aXplU2l6ZShjb250ZW50LlNpemUpXG4gICAgICAgIHJlc3VsdC5vYmplY3RzLnB1c2goeyBuYW1lLCBsYXN0TW9kaWZpZWQsIGV0YWcsIHNpemUgfSlcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgaWYgKGxpc3RCdWNrZXRSZXN1bHQuTmV4dE1hcmtlcikge1xuICAgICAgbmV4dE1hcmtlciA9IGxpc3RCdWNrZXRSZXN1bHQuTmV4dE1hcmtlclxuICAgIH1cbiAgICBwYXJzZUNvbW1vblByZWZpeGVzRW50aXR5KGxpc3RCdWNrZXRSZXN1bHQuQ29tbW9uUHJlZml4ZXMpXG4gIH1cblxuICBpZiAobGlzdFZlcnNpb25zUmVzdWx0KSB7XG4gICAgaWYgKGxpc3RWZXJzaW9uc1Jlc3VsdC5Jc1RydW5jYXRlZCkge1xuICAgICAgaXNUcnVuY2F0ZWQgPSBsaXN0VmVyc2lvbnNSZXN1bHQuSXNUcnVuY2F0ZWRcbiAgICB9XG5cbiAgICBpZiAobGlzdFZlcnNpb25zUmVzdWx0LlZlcnNpb24pIHtcbiAgICAgIHRvQXJyYXkobGlzdFZlcnNpb25zUmVzdWx0LlZlcnNpb24pLmZvckVhY2goKGNvbnRlbnQpID0+IHtcbiAgICAgICAgcmVzdWx0Lm9iamVjdHMucHVzaChmb3JtYXRPYmpJbmZvKGNvbnRlbnQpKVxuICAgICAgfSlcbiAgICB9XG4gICAgaWYgKGxpc3RWZXJzaW9uc1Jlc3VsdC5EZWxldGVNYXJrZXIpIHtcbiAgICAgIHRvQXJyYXkobGlzdFZlcnNpb25zUmVzdWx0LkRlbGV0ZU1hcmtlcikuZm9yRWFjaCgoY29udGVudCkgPT4ge1xuICAgICAgICByZXN1bHQub2JqZWN0cy5wdXNoKGZvcm1hdE9iakluZm8oY29udGVudCwgeyBJc0RlbGV0ZU1hcmtlcjogdHJ1ZSB9KSlcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgaWYgKGxpc3RWZXJzaW9uc1Jlc3VsdC5OZXh0S2V5TWFya2VyKSB7XG4gICAgICBuZXh0VmVyc2lvbktleU1hcmtlciA9IGxpc3RWZXJzaW9uc1Jlc3VsdC5OZXh0S2V5TWFya2VyXG4gICAgfVxuICAgIGlmIChsaXN0VmVyc2lvbnNSZXN1bHQuTmV4dFZlcnNpb25JZE1hcmtlcikge1xuICAgICAgcmVzdWx0LnZlcnNpb25JZE1hcmtlciA9IGxpc3RWZXJzaW9uc1Jlc3VsdC5OZXh0VmVyc2lvbklkTWFya2VyXG4gICAgfVxuICAgIHBhcnNlQ29tbW9uUHJlZml4ZXNFbnRpdHkobGlzdFZlcnNpb25zUmVzdWx0LkNvbW1vblByZWZpeGVzKVxuICB9XG5cbiAgcmVzdWx0LmlzVHJ1bmNhdGVkID0gaXNUcnVuY2F0ZWRcbiAgaWYgKGlzVHJ1bmNhdGVkKSB7XG4gICAgcmVzdWx0Lm5leHRNYXJrZXIgPSBuZXh0VmVyc2lvbktleU1hcmtlciB8fCBuZXh0TWFya2VyXG4gIH1cbiAgcmV0dXJuIHJlc3VsdFxufVxuXG4vLyBwYXJzZSBYTUwgcmVzcG9uc2UgZm9yIGxpc3Qgb2JqZWN0cyB2MiBpbiBhIGJ1Y2tldFxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlTGlzdE9iamVjdHNWMih4bWwpIHtcbiAgdmFyIHJlc3VsdCA9IHtcbiAgICBvYmplY3RzOiBbXSxcbiAgICBpc1RydW5jYXRlZDogZmFsc2UsXG4gIH1cbiAgdmFyIHhtbG9iaiA9IHBhcnNlWG1sKHhtbClcbiAgaWYgKCF4bWxvYmouTGlzdEJ1Y2tldFJlc3VsdCkge1xuICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZFhNTEVycm9yKCdNaXNzaW5nIHRhZzogXCJMaXN0QnVja2V0UmVzdWx0XCInKVxuICB9XG4gIHhtbG9iaiA9IHhtbG9iai5MaXN0QnVja2V0UmVzdWx0XG4gIGlmICh4bWxvYmouSXNUcnVuY2F0ZWQpIHtcbiAgICByZXN1bHQuaXNUcnVuY2F0ZWQgPSB4bWxvYmouSXNUcnVuY2F0ZWRcbiAgfVxuICBpZiAoeG1sb2JqLk5leHRDb250aW51YXRpb25Ub2tlbikge1xuICAgIHJlc3VsdC5uZXh0Q29udGludWF0aW9uVG9rZW4gPSB4bWxvYmouTmV4dENvbnRpbnVhdGlvblRva2VuXG4gIH1cbiAgaWYgKHhtbG9iai5Db250ZW50cykge1xuICAgIHRvQXJyYXkoeG1sb2JqLkNvbnRlbnRzKS5mb3JFYWNoKChjb250ZW50KSA9PiB7XG4gICAgICB2YXIgbmFtZSA9IHNhbml0aXplT2JqZWN0S2V5KHRvQXJyYXkoY29udGVudC5LZXkpWzBdKVxuICAgICAgdmFyIGxhc3RNb2RpZmllZCA9IG5ldyBEYXRlKGNvbnRlbnQuTGFzdE1vZGlmaWVkKVxuICAgICAgdmFyIGV0YWcgPSBzYW5pdGl6ZUVUYWcoY29udGVudC5FVGFnKVxuICAgICAgdmFyIHNpemUgPSBjb250ZW50LlNpemVcbiAgICAgIHJlc3VsdC5vYmplY3RzLnB1c2goeyBuYW1lLCBsYXN0TW9kaWZpZWQsIGV0YWcsIHNpemUgfSlcbiAgICB9KVxuICB9XG4gIGlmICh4bWxvYmouQ29tbW9uUHJlZml4ZXMpIHtcbiAgICB0b0FycmF5KHhtbG9iai5Db21tb25QcmVmaXhlcykuZm9yRWFjaCgoY29tbW9uUHJlZml4KSA9PiB7XG4gICAgICByZXN1bHQub2JqZWN0cy5wdXNoKHsgcHJlZml4OiBzYW5pdGl6ZU9iamVjdEtleSh0b0FycmF5KGNvbW1vblByZWZpeC5QcmVmaXgpWzBdKSwgc2l6ZTogMCB9KVxuICAgIH0pXG4gIH1cbiAgcmV0dXJuIHJlc3VsdFxufVxuXG4vLyBwYXJzZSBYTUwgcmVzcG9uc2UgZm9yIGxpc3Qgb2JqZWN0cyB2MiB3aXRoIG1ldGFkYXRhIGluIGEgYnVja2V0XG5leHBvcnQgZnVuY3Rpb24gcGFyc2VMaXN0T2JqZWN0c1YyV2l0aE1ldGFkYXRhKHhtbCkge1xuICB2YXIgcmVzdWx0ID0ge1xuICAgIG9iamVjdHM6IFtdLFxuICAgIGlzVHJ1bmNhdGVkOiBmYWxzZSxcbiAgfVxuICB2YXIgeG1sb2JqID0gcGFyc2VYbWwoeG1sKVxuICBpZiAoIXhtbG9iai5MaXN0QnVja2V0UmVzdWx0KSB7XG4gICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkWE1MRXJyb3IoJ01pc3NpbmcgdGFnOiBcIkxpc3RCdWNrZXRSZXN1bHRcIicpXG4gIH1cbiAgeG1sb2JqID0geG1sb2JqLkxpc3RCdWNrZXRSZXN1bHRcbiAgaWYgKHhtbG9iai5Jc1RydW5jYXRlZCkge1xuICAgIHJlc3VsdC5pc1RydW5jYXRlZCA9IHhtbG9iai5Jc1RydW5jYXRlZFxuICB9XG4gIGlmICh4bWxvYmouTmV4dENvbnRpbnVhdGlvblRva2VuKSB7XG4gICAgcmVzdWx0Lm5leHRDb250aW51YXRpb25Ub2tlbiA9IHhtbG9iai5OZXh0Q29udGludWF0aW9uVG9rZW5cbiAgfVxuXG4gIGlmICh4bWxvYmouQ29udGVudHMpIHtcbiAgICB0b0FycmF5KHhtbG9iai5Db250ZW50cykuZm9yRWFjaCgoY29udGVudCkgPT4ge1xuICAgICAgdmFyIG5hbWUgPSBzYW5pdGl6ZU9iamVjdEtleShjb250ZW50LktleSlcbiAgICAgIHZhciBsYXN0TW9kaWZpZWQgPSBuZXcgRGF0ZShjb250ZW50Lkxhc3RNb2RpZmllZClcbiAgICAgIHZhciBldGFnID0gc2FuaXRpemVFVGFnKGNvbnRlbnQuRVRhZylcbiAgICAgIHZhciBzaXplID0gY29udGVudC5TaXplXG4gICAgICB2YXIgbWV0YWRhdGFcbiAgICAgIGlmIChjb250ZW50LlVzZXJNZXRhZGF0YSAhPSBudWxsKSB7XG4gICAgICAgIG1ldGFkYXRhID0gdG9BcnJheShjb250ZW50LlVzZXJNZXRhZGF0YSlbMF1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG1ldGFkYXRhID0gbnVsbFxuICAgICAgfVxuICAgICAgcmVzdWx0Lm9iamVjdHMucHVzaCh7IG5hbWUsIGxhc3RNb2RpZmllZCwgZXRhZywgc2l6ZSwgbWV0YWRhdGEgfSlcbiAgICB9KVxuICB9XG5cbiAgaWYgKHhtbG9iai5Db21tb25QcmVmaXhlcykge1xuICAgIHRvQXJyYXkoeG1sb2JqLkNvbW1vblByZWZpeGVzKS5mb3JFYWNoKChjb21tb25QcmVmaXgpID0+IHtcbiAgICAgIHJlc3VsdC5vYmplY3RzLnB1c2goeyBwcmVmaXg6IHNhbml0aXplT2JqZWN0S2V5KHRvQXJyYXkoY29tbW9uUHJlZml4LlByZWZpeClbMF0pLCBzaXplOiAwIH0pXG4gICAgfSlcbiAgfVxuICByZXR1cm4gcmVzdWx0XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUxpZmVjeWNsZUNvbmZpZyh4bWwpIHtcbiAgY29uc3QgeG1sT2JqID0gcGFyc2VYbWwoeG1sKVxuICByZXR1cm4geG1sT2JqLkxpZmVjeWNsZUNvbmZpZ3VyYXRpb25cbn1cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZU9iamVjdFJldGVudGlvbkNvbmZpZyh4bWwpIHtcbiAgY29uc3QgeG1sT2JqID0gcGFyc2VYbWwoeG1sKVxuICBjb25zdCByZXRlbnRpb25Db25maWcgPSB4bWxPYmouUmV0ZW50aW9uXG5cbiAgcmV0dXJuIHtcbiAgICBtb2RlOiByZXRlbnRpb25Db25maWcuTW9kZSxcbiAgICByZXRhaW5VbnRpbERhdGU6IHJldGVudGlvbkNvbmZpZy5SZXRhaW5VbnRpbERhdGUsXG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlQnVja2V0RW5jcnlwdGlvbkNvbmZpZyh4bWwpIHtcbiAgbGV0IGVuY0NvbmZpZyA9IHBhcnNlWG1sKHhtbClcbiAgcmV0dXJuIGVuY0NvbmZpZ1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VPYmplY3RMZWdhbEhvbGRDb25maWcoeG1sKSB7XG4gIGNvbnN0IHhtbE9iaiA9IHBhcnNlWG1sKHhtbClcbiAgcmV0dXJuIHhtbE9iai5MZWdhbEhvbGRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHVwbG9hZFBhcnRQYXJzZXIoeG1sKSB7XG4gIGNvbnN0IHhtbE9iaiA9IHBhcnNlWG1sKHhtbClcbiAgY29uc3QgcmVzcEVsID0geG1sT2JqLkNvcHlQYXJ0UmVzdWx0XG4gIHJldHVybiByZXNwRWxcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlbW92ZU9iamVjdHNQYXJzZXIoeG1sKSB7XG4gIGNvbnN0IHhtbE9iaiA9IHBhcnNlWG1sKHhtbClcbiAgaWYgKHhtbE9iai5EZWxldGVSZXN1bHQgJiYgeG1sT2JqLkRlbGV0ZVJlc3VsdC5FcnJvcikge1xuICAgIC8vIHJldHVybiBlcnJvcnMgYXMgYXJyYXkgYWx3YXlzLiBhcyB0aGUgcmVzcG9uc2UgaXMgb2JqZWN0IGluIGNhc2Ugb2Ygc2luZ2xlIG9iamVjdCBwYXNzZWQgaW4gcmVtb3ZlT2JqZWN0c1xuICAgIHJldHVybiB0b0FycmF5KHhtbE9iai5EZWxldGVSZXN1bHQuRXJyb3IpXG4gIH1cbiAgcmV0dXJuIFtdXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVNlbGVjdE9iamVjdENvbnRlbnRSZXNwb25zZShyZXMpIHtcbiAgLy8gZXh0cmFjdEhlYWRlclR5cGUgZXh0cmFjdHMgdGhlIGZpcnN0IGhhbGYgb2YgdGhlIGhlYWRlciBtZXNzYWdlLCB0aGUgaGVhZGVyIHR5cGUuXG4gIGZ1bmN0aW9uIGV4dHJhY3RIZWFkZXJUeXBlKHN0cmVhbSkge1xuICAgIGNvbnN0IGhlYWRlck5hbWVMZW4gPSBCdWZmZXIuZnJvbShzdHJlYW0ucmVhZCgxKSkucmVhZFVJbnQ4KClcbiAgICBjb25zdCBoZWFkZXJOYW1lV2l0aFNlcGFyYXRvciA9IEJ1ZmZlci5mcm9tKHN0cmVhbS5yZWFkKGhlYWRlck5hbWVMZW4pKS50b1N0cmluZygpXG4gICAgY29uc3Qgc3BsaXRCeVNlcGFyYXRvciA9IChoZWFkZXJOYW1lV2l0aFNlcGFyYXRvciB8fCAnJykuc3BsaXQoJzonKVxuICAgIGNvbnN0IGhlYWRlck5hbWUgPSBzcGxpdEJ5U2VwYXJhdG9yLmxlbmd0aCA+PSAxID8gc3BsaXRCeVNlcGFyYXRvclsxXSA6ICcnXG4gICAgcmV0dXJuIGhlYWRlck5hbWVcbiAgfVxuXG4gIGZ1bmN0aW9uIGV4dHJhY3RIZWFkZXJWYWx1ZShzdHJlYW0pIHtcbiAgICBjb25zdCBib2R5TGVuID0gQnVmZmVyLmZyb20oc3RyZWFtLnJlYWQoMikpLnJlYWRVSW50MTZCRSgpXG4gICAgY29uc3QgYm9keU5hbWUgPSBCdWZmZXIuZnJvbShzdHJlYW0ucmVhZChib2R5TGVuKSkudG9TdHJpbmcoKVxuICAgIHJldHVybiBib2R5TmFtZVxuICB9XG5cbiAgY29uc3Qgc2VsZWN0UmVzdWx0cyA9IG5ldyBTZWxlY3RSZXN1bHRzKHt9KSAvLyB3aWxsIGJlIHJldHVybmVkXG5cbiAgY29uc3QgcmVzcG9uc2VTdHJlYW0gPSByZWFkYWJsZVN0cmVhbShyZXMpIC8vIGNvbnZlcnQgYnl0ZSBhcnJheSB0byBhIHJlYWRhYmxlIHJlc3BvbnNlU3RyZWFtXG4gIHdoaWxlIChyZXNwb25zZVN0cmVhbS5fcmVhZGFibGVTdGF0ZS5sZW5ndGgpIHtcbiAgICAvLyBUb3AgbGV2ZWwgcmVzcG9uc2VTdHJlYW0gcmVhZCB0cmFja2VyLlxuICAgIGxldCBtc2dDcmNBY2N1bXVsYXRvciAvLyBhY2N1bXVsYXRlIGZyb20gc3RhcnQgb2YgdGhlIG1lc3NhZ2UgdGlsbCB0aGUgbWVzc2FnZSBjcmMgc3RhcnQuXG5cbiAgICBjb25zdCB0b3RhbEJ5dGVMZW5ndGhCdWZmZXIgPSBCdWZmZXIuZnJvbShyZXNwb25zZVN0cmVhbS5yZWFkKDQpKVxuICAgIG1zZ0NyY0FjY3VtdWxhdG9yID0gY3JjMzIodG90YWxCeXRlTGVuZ3RoQnVmZmVyKVxuXG4gICAgY29uc3QgaGVhZGVyQnl0ZXNCdWZmZXIgPSBCdWZmZXIuZnJvbShyZXNwb25zZVN0cmVhbS5yZWFkKDQpKVxuICAgIG1zZ0NyY0FjY3VtdWxhdG9yID0gY3JjMzIoaGVhZGVyQnl0ZXNCdWZmZXIsIG1zZ0NyY0FjY3VtdWxhdG9yKVxuXG4gICAgY29uc3QgY2FsY3VsYXRlZFByZWx1ZGVDcmMgPSBtc2dDcmNBY2N1bXVsYXRvci5yZWFkSW50MzJCRSgpIC8vIHVzZSBpdCB0byBjaGVjayBpZiBhbnkgQ1JDIG1pc21hdGNoIGluIGhlYWRlciBpdHNlbGYuXG5cbiAgICBjb25zdCBwcmVsdWRlQ3JjQnVmZmVyID0gQnVmZmVyLmZyb20ocmVzcG9uc2VTdHJlYW0ucmVhZCg0KSkgLy8gcmVhZCA0IGJ5dGVzICAgIGkuZSA0KzQgPTggKyA0ID0gMTIgKCBwcmVsdWRlICsgcHJlbHVkZSBjcmMpXG4gICAgbXNnQ3JjQWNjdW11bGF0b3IgPSBjcmMzMihwcmVsdWRlQ3JjQnVmZmVyLCBtc2dDcmNBY2N1bXVsYXRvcilcblxuICAgIGNvbnN0IHRvdGFsTXNnTGVuZ3RoID0gdG90YWxCeXRlTGVuZ3RoQnVmZmVyLnJlYWRJbnQzMkJFKClcbiAgICBjb25zdCBoZWFkZXJMZW5ndGggPSBoZWFkZXJCeXRlc0J1ZmZlci5yZWFkSW50MzJCRSgpXG4gICAgY29uc3QgcHJlbHVkZUNyY0J5dGVWYWx1ZSA9IHByZWx1ZGVDcmNCdWZmZXIucmVhZEludDMyQkUoKVxuXG4gICAgaWYgKHByZWx1ZGVDcmNCeXRlVmFsdWUgIT09IGNhbGN1bGF0ZWRQcmVsdWRlQ3JjKSB7XG4gICAgICAvLyBIYW5kbGUgSGVhZGVyIENSQyBtaXNtYXRjaCBFcnJvclxuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBgSGVhZGVyIENoZWNrc3VtIE1pc21hdGNoLCBQcmVsdWRlIENSQyBvZiAke3ByZWx1ZGVDcmNCeXRlVmFsdWV9IGRvZXMgbm90IGVxdWFsIGV4cGVjdGVkIENSQyBvZiAke2NhbGN1bGF0ZWRQcmVsdWRlQ3JjfWAsXG4gICAgICApXG4gICAgfVxuXG4gICAgY29uc3QgaGVhZGVycyA9IHt9XG4gICAgaWYgKGhlYWRlckxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IGhlYWRlckJ5dGVzID0gQnVmZmVyLmZyb20ocmVzcG9uc2VTdHJlYW0ucmVhZChoZWFkZXJMZW5ndGgpKVxuICAgICAgbXNnQ3JjQWNjdW11bGF0b3IgPSBjcmMzMihoZWFkZXJCeXRlcywgbXNnQ3JjQWNjdW11bGF0b3IpXG4gICAgICBjb25zdCBoZWFkZXJSZWFkZXJTdHJlYW0gPSByZWFkYWJsZVN0cmVhbShoZWFkZXJCeXRlcylcbiAgICAgIHdoaWxlIChoZWFkZXJSZWFkZXJTdHJlYW0uX3JlYWRhYmxlU3RhdGUubGVuZ3RoKSB7XG4gICAgICAgIGxldCBoZWFkZXJUeXBlTmFtZSA9IGV4dHJhY3RIZWFkZXJUeXBlKGhlYWRlclJlYWRlclN0cmVhbSlcbiAgICAgICAgaGVhZGVyUmVhZGVyU3RyZWFtLnJlYWQoMSkgLy8ganVzdCByZWFkIGFuZCBpZ25vcmUgaXQuXG4gICAgICAgIGhlYWRlcnNbaGVhZGVyVHlwZU5hbWVdID0gZXh0cmFjdEhlYWRlclZhbHVlKGhlYWRlclJlYWRlclN0cmVhbSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICBsZXQgcGF5bG9hZFN0cmVhbVxuICAgIGNvbnN0IHBheUxvYWRMZW5ndGggPSB0b3RhbE1zZ0xlbmd0aCAtIGhlYWRlckxlbmd0aCAtIDE2XG4gICAgaWYgKHBheUxvYWRMZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBwYXlMb2FkQnVmZmVyID0gQnVmZmVyLmZyb20ocmVzcG9uc2VTdHJlYW0ucmVhZChwYXlMb2FkTGVuZ3RoKSlcbiAgICAgIG1zZ0NyY0FjY3VtdWxhdG9yID0gY3JjMzIocGF5TG9hZEJ1ZmZlciwgbXNnQ3JjQWNjdW11bGF0b3IpXG4gICAgICAvLyByZWFkIHRoZSBjaGVja3N1bSBlYXJseSBhbmQgZGV0ZWN0IGFueSBtaXNtYXRjaCBzbyB3ZSBjYW4gYXZvaWQgdW5uZWNlc3NhcnkgZnVydGhlciBwcm9jZXNzaW5nLlxuICAgICAgY29uc3QgbWVzc2FnZUNyY0J5dGVWYWx1ZSA9IEJ1ZmZlci5mcm9tKHJlc3BvbnNlU3RyZWFtLnJlYWQoNCkpLnJlYWRJbnQzMkJFKClcbiAgICAgIGNvbnN0IGNhbGN1bGF0ZWRDcmMgPSBtc2dDcmNBY2N1bXVsYXRvci5yZWFkSW50MzJCRSgpXG4gICAgICAvLyBIYW5kbGUgbWVzc2FnZSBDUkMgRXJyb3JcbiAgICAgIGlmIChtZXNzYWdlQ3JjQnl0ZVZhbHVlICE9PSBjYWxjdWxhdGVkQ3JjKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICBgTWVzc2FnZSBDaGVja3N1bSBNaXNtYXRjaCwgTWVzc2FnZSBDUkMgb2YgJHttZXNzYWdlQ3JjQnl0ZVZhbHVlfSBkb2VzIG5vdCBlcXVhbCBleHBlY3RlZCBDUkMgb2YgJHtjYWxjdWxhdGVkQ3JjfWAsXG4gICAgICAgIClcbiAgICAgIH1cbiAgICAgIHBheWxvYWRTdHJlYW0gPSByZWFkYWJsZVN0cmVhbShwYXlMb2FkQnVmZmVyKVxuICAgIH1cblxuICAgIGNvbnN0IG1lc3NhZ2VUeXBlID0gaGVhZGVyc1snbWVzc2FnZS10eXBlJ11cblxuICAgIHN3aXRjaCAobWVzc2FnZVR5cGUpIHtcbiAgICAgIGNhc2UgJ2Vycm9yJzoge1xuICAgICAgICBjb25zdCBlcnJvck1lc3NhZ2UgPSBoZWFkZXJzWydlcnJvci1jb2RlJ10gKyAnOlwiJyArIGhlYWRlcnNbJ2Vycm9yLW1lc3NhZ2UnXSArICdcIidcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGVycm9yTWVzc2FnZSlcbiAgICAgIH1cbiAgICAgIGNhc2UgJ2V2ZW50Jzoge1xuICAgICAgICBjb25zdCBjb250ZW50VHlwZSA9IGhlYWRlcnNbJ2NvbnRlbnQtdHlwZSddXG4gICAgICAgIGNvbnN0IGV2ZW50VHlwZSA9IGhlYWRlcnNbJ2V2ZW50LXR5cGUnXVxuXG4gICAgICAgIHN3aXRjaCAoZXZlbnRUeXBlKSB7XG4gICAgICAgICAgY2FzZSAnRW5kJzoge1xuICAgICAgICAgICAgc2VsZWN0UmVzdWx0cy5zZXRSZXNwb25zZShyZXMpXG4gICAgICAgICAgICByZXR1cm4gc2VsZWN0UmVzdWx0c1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGNhc2UgJ1JlY29yZHMnOiB7XG4gICAgICAgICAgICBjb25zdCByZWFkRGF0YSA9IHBheWxvYWRTdHJlYW0ucmVhZChwYXlMb2FkTGVuZ3RoKVxuICAgICAgICAgICAgc2VsZWN0UmVzdWx0cy5zZXRSZWNvcmRzKHJlYWREYXRhKVxuICAgICAgICAgICAgYnJlYWtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBjYXNlICdQcm9ncmVzcyc6XG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIHN3aXRjaCAoY29udGVudFR5cGUpIHtcbiAgICAgICAgICAgICAgICBjYXNlICd0ZXh0L3htbCc6IHtcbiAgICAgICAgICAgICAgICAgIGNvbnN0IHByb2dyZXNzRGF0YSA9IHBheWxvYWRTdHJlYW0ucmVhZChwYXlMb2FkTGVuZ3RoKVxuICAgICAgICAgICAgICAgICAgc2VsZWN0UmVzdWx0cy5zZXRQcm9ncmVzcyhwcm9ncmVzc0RhdGEudG9TdHJpbmcoKSlcbiAgICAgICAgICAgICAgICAgIGJyZWFrXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGRlZmF1bHQ6IHtcbiAgICAgICAgICAgICAgICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGBVbmV4cGVjdGVkIGNvbnRlbnQtdHlwZSAke2NvbnRlbnRUeXBlfSBzZW50IGZvciBldmVudC10eXBlIFByb2dyZXNzYFxuICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGVycm9yTWVzc2FnZSlcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGJyZWFrXG4gICAgICAgICAgY2FzZSAnU3RhdHMnOlxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBzd2l0Y2ggKGNvbnRlbnRUeXBlKSB7XG4gICAgICAgICAgICAgICAgY2FzZSAndGV4dC94bWwnOiB7XG4gICAgICAgICAgICAgICAgICBjb25zdCBzdGF0c0RhdGEgPSBwYXlsb2FkU3RyZWFtLnJlYWQocGF5TG9hZExlbmd0aClcbiAgICAgICAgICAgICAgICAgIHNlbGVjdFJlc3VsdHMuc2V0U3RhdHMoc3RhdHNEYXRhLnRvU3RyaW5nKCkpXG4gICAgICAgICAgICAgICAgICBicmVha1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBkZWZhdWx0OiB7XG4gICAgICAgICAgICAgICAgICBjb25zdCBlcnJvck1lc3NhZ2UgPSBgVW5leHBlY3RlZCBjb250ZW50LXR5cGUgJHtjb250ZW50VHlwZX0gc2VudCBmb3IgZXZlbnQtdHlwZSBTdGF0c2BcbiAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihlcnJvck1lc3NhZ2UpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBicmVha1xuICAgICAgICAgIGRlZmF1bHQ6IHtcbiAgICAgICAgICAgIC8vIENvbnRpbnVhdGlvbiBtZXNzYWdlOiBOb3Qgc3VyZSBpZiBpdCBpcyBzdXBwb3J0ZWQuIGRpZCBub3QgZmluZCBhIHJlZmVyZW5jZSBvciBhbnkgbWVzc2FnZSBpbiByZXNwb25zZS5cbiAgICAgICAgICAgIC8vIEl0IGRvZXMgbm90IGhhdmUgYSBwYXlsb2FkLlxuICAgICAgICAgICAgY29uc3Qgd2FybmluZ01lc3NhZ2UgPSBgVW4gaW1wbGVtZW50ZWQgZXZlbnQgZGV0ZWN0ZWQgICR7bWVzc2FnZVR5cGV9LmBcbiAgICAgICAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG4gICAgICAgICAgICBjb25zb2xlLndhcm4od2FybmluZ01lc3NhZ2UpXG4gICAgICAgICAgfVxuICAgICAgICB9IC8vIGV2ZW50VHlwZSBFbmRcbiAgICAgIH0gLy8gRXZlbnQgRW5kXG4gICAgfSAvLyBtZXNzYWdlVHlwZSBFbmRcbiAgfSAvLyBUb3AgTGV2ZWwgU3RyZWFtIEVuZFxufVxuIl0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7OztBQWdCQSxJQUFBQSxVQUFBLEdBQUFDLE9BQUE7QUFDQSxJQUFBQyxjQUFBLEdBQUFELE9BQUE7QUFFQSxJQUFBRSxNQUFBLEdBQUFDLHVCQUFBLENBQUFILE9BQUE7QUFDQSxJQUFBSSxRQUFBLEdBQUFKLE9BQUE7QUFDQSxJQUFBSyxPQUFBLEdBQUFMLE9BQUE7QUFRNkIsU0FBQU0seUJBQUFDLFdBQUEsZUFBQUMsT0FBQSxrQ0FBQUMsaUJBQUEsT0FBQUQsT0FBQSxRQUFBRSxnQkFBQSxPQUFBRixPQUFBLFlBQUFGLHdCQUFBLFlBQUFBLENBQUFDLFdBQUEsV0FBQUEsV0FBQSxHQUFBRyxnQkFBQSxHQUFBRCxpQkFBQSxLQUFBRixXQUFBO0FBQUEsU0FBQUosd0JBQUFRLEdBQUEsRUFBQUosV0FBQSxTQUFBQSxXQUFBLElBQUFJLEdBQUEsSUFBQUEsR0FBQSxDQUFBQyxVQUFBLFdBQUFELEdBQUEsUUFBQUEsR0FBQSxvQkFBQUEsR0FBQSx3QkFBQUEsR0FBQSw0QkFBQUUsT0FBQSxFQUFBRixHQUFBLFVBQUFHLEtBQUEsR0FBQVIsd0JBQUEsQ0FBQUMsV0FBQSxPQUFBTyxLQUFBLElBQUFBLEtBQUEsQ0FBQUMsR0FBQSxDQUFBSixHQUFBLFlBQUFHLEtBQUEsQ0FBQUUsR0FBQSxDQUFBTCxHQUFBLFNBQUFNLE1BQUEsV0FBQUMscUJBQUEsR0FBQUMsTUFBQSxDQUFBQyxjQUFBLElBQUFELE1BQUEsQ0FBQUUsd0JBQUEsV0FBQUMsR0FBQSxJQUFBWCxHQUFBLFFBQUFXLEdBQUEsa0JBQUFILE1BQUEsQ0FBQUksU0FBQSxDQUFBQyxjQUFBLENBQUFDLElBQUEsQ0FBQWQsR0FBQSxFQUFBVyxHQUFBLFNBQUFJLElBQUEsR0FBQVIscUJBQUEsR0FBQUMsTUFBQSxDQUFBRSx3QkFBQSxDQUFBVixHQUFBLEVBQUFXLEdBQUEsY0FBQUksSUFBQSxLQUFBQSxJQUFBLENBQUFWLEdBQUEsSUFBQVUsSUFBQSxDQUFBQyxHQUFBLEtBQUFSLE1BQUEsQ0FBQUMsY0FBQSxDQUFBSCxNQUFBLEVBQUFLLEdBQUEsRUFBQUksSUFBQSxZQUFBVCxNQUFBLENBQUFLLEdBQUEsSUFBQVgsR0FBQSxDQUFBVyxHQUFBLFNBQUFMLE1BQUEsQ0FBQUosT0FBQSxHQUFBRixHQUFBLE1BQUFHLEtBQUEsSUFBQUEsS0FBQSxDQUFBYSxHQUFBLENBQUFoQixHQUFBLEVBQUFNLE1BQUEsWUFBQUEsTUFBQTtBQTdCN0I7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQWlCQSxNQUFNVyxtQkFBbUIsR0FBRyxJQUFJQyx3QkFBUyxDQUFDO0VBQ3hDQyxrQkFBa0IsRUFBRTtJQUNsQkMsUUFBUSxFQUFFO0VBQ1o7QUFDRixDQUFDLENBQUM7O0FBRUY7QUFDTyxTQUFTQyxlQUFlQSxDQUFDQyxHQUFHLEVBQUU7RUFDbkMsSUFBSUMsTUFBTSxHQUFHO0lBQ1hDLElBQUksRUFBRSxFQUFFO0lBQ1JDLFlBQVksRUFBRTtFQUNoQixDQUFDO0VBRUQsSUFBSUMsTUFBTSxHQUFHLElBQUFDLGdCQUFRLEVBQUNMLEdBQUcsQ0FBQztFQUMxQixJQUFJLENBQUNJLE1BQU0sQ0FBQ0UsZ0JBQWdCLEVBQUU7SUFDNUIsTUFBTSxJQUFJckMsTUFBTSxDQUFDc0MsZUFBZSxDQUFDLGlDQUFpQyxDQUFDO0VBQ3JFO0VBQ0FILE1BQU0sR0FBR0EsTUFBTSxDQUFDRSxnQkFBZ0I7RUFDaEMsSUFBSUYsTUFBTSxDQUFDSSxJQUFJLEVBQUU7SUFDZlAsTUFBTSxDQUFDQyxJQUFJLEdBQUdFLE1BQU0sQ0FBQ0ksSUFBSSxDQUFDQyxPQUFPLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxDQUN6Q0EsT0FBTyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FDbEJBLE9BQU8sQ0FBQyxVQUFVLEVBQUUsRUFBRSxDQUFDLENBQ3ZCQSxPQUFPLENBQUMsVUFBVSxFQUFFLEVBQUUsQ0FBQyxDQUN2QkEsT0FBTyxDQUFDLFNBQVMsRUFBRSxFQUFFLENBQUMsQ0FDdEJBLE9BQU8sQ0FBQyxTQUFTLEVBQUUsRUFBRSxDQUFDO0VBQzNCO0VBQ0EsSUFBSUwsTUFBTSxDQUFDTSxZQUFZLEVBQUU7SUFDdkJULE1BQU0sQ0FBQ0UsWUFBWSxHQUFHLElBQUlRLElBQUksQ0FBQ1AsTUFBTSxDQUFDTSxZQUFZLENBQUM7RUFDckQ7RUFFQSxPQUFPVCxNQUFNO0FBQ2Y7O0FBRUE7QUFDTyxTQUFTVyx1QkFBdUJBLENBQUNaLEdBQUcsRUFBRTtFQUMzQyxJQUFJQyxNQUFNLEdBQUc7SUFDWFksa0JBQWtCLEVBQUUsRUFBRTtJQUN0QkMsa0JBQWtCLEVBQUUsRUFBRTtJQUN0QkMsMEJBQTBCLEVBQUU7RUFDOUIsQ0FBQztFQUNEO0VBQ0EsSUFBSUMsU0FBUyxHQUFHLFNBQUFBLENBQVVDLE1BQU0sRUFBRTtJQUNoQyxJQUFJaEIsTUFBTSxHQUFHLEVBQUU7SUFDZixJQUFJZ0IsTUFBTSxFQUFFO01BQ1YsSUFBQUMsZUFBTyxFQUFDRCxNQUFNLENBQUMsQ0FBQ0UsT0FBTyxDQUFFQyxPQUFPLElBQUs7UUFDbkNuQixNQUFNLENBQUNvQixJQUFJLENBQUNELE9BQU8sQ0FBQztNQUN0QixDQUFDLENBQUM7SUFDSjtJQUNBLE9BQU9uQixNQUFNO0VBQ2YsQ0FBQztFQUNEO0VBQ0EsSUFBSXFCLGNBQWMsR0FBRyxTQUFBQSxDQUFVQyxPQUFPLEVBQUU7SUFDdEMsSUFBSXRCLE1BQU0sR0FBRyxFQUFFO0lBQ2YsSUFBSXNCLE9BQU8sRUFBRTtNQUNYQSxPQUFPLEdBQUcsSUFBQUwsZUFBTyxFQUFDSyxPQUFPLENBQUM7TUFDMUIsSUFBSUEsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDQyxLQUFLLEVBQUU7UUFDcEJELE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQ0MsS0FBSyxHQUFHLElBQUFOLGVBQU8sRUFBQ0ssT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDQyxLQUFLLENBQUM7UUFDNUMsSUFBSUQsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUNDLFVBQVUsRUFBRTtVQUNsQyxJQUFBUCxlQUFPLEVBQUNLLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQ0MsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDQyxVQUFVLENBQUMsQ0FBQ04sT0FBTyxDQUFFTyxJQUFJLElBQUs7WUFDeEQsSUFBSUMsSUFBSSxHQUFHLElBQUFULGVBQU8sRUFBQ1EsSUFBSSxDQUFDQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDaEMsSUFBSUMsS0FBSyxHQUFHLElBQUFWLGVBQU8sRUFBQ1EsSUFBSSxDQUFDRSxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDbEMzQixNQUFNLENBQUNvQixJQUFJLENBQUM7Y0FBRU0sSUFBSTtjQUFFQztZQUFNLENBQUMsQ0FBQztVQUM5QixDQUFDLENBQUM7UUFDSjtNQUNGO0lBQ0Y7SUFDQSxPQUFPM0IsTUFBTTtFQUNmLENBQUM7RUFFRCxJQUFJRyxNQUFNLEdBQUcsSUFBQUMsZ0JBQVEsRUFBQ0wsR0FBRyxDQUFDO0VBQzFCSSxNQUFNLEdBQUdBLE1BQU0sQ0FBQ3lCLHlCQUF5Qjs7RUFFekM7RUFDQSxJQUFJekIsTUFBTSxDQUFDUyxrQkFBa0IsRUFBRTtJQUM3QixJQUFBSyxlQUFPLEVBQUNkLE1BQU0sQ0FBQ1Msa0JBQWtCLENBQUMsQ0FBQ00sT0FBTyxDQUFFVyxNQUFNLElBQUs7TUFDckQsSUFBSUMsRUFBRSxHQUFHLElBQUFiLGVBQU8sRUFBQ1ksTUFBTSxDQUFDQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7TUFDOUIsSUFBSUMsS0FBSyxHQUFHLElBQUFkLGVBQU8sRUFBQ1ksTUFBTSxDQUFDRSxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUM7TUFDcEMsSUFBSUMsS0FBSyxHQUFHakIsU0FBUyxDQUFDYyxNQUFNLENBQUNHLEtBQUssQ0FBQztNQUNuQyxJQUFJQyxNQUFNLEdBQUdaLGNBQWMsQ0FBQ1EsTUFBTSxDQUFDSSxNQUFNLENBQUM7TUFDMUNqQyxNQUFNLENBQUNZLGtCQUFrQixDQUFDUSxJQUFJLENBQUM7UUFBRVUsRUFBRTtRQUFFQyxLQUFLO1FBQUVDLEtBQUs7UUFBRUM7TUFBTyxDQUFDLENBQUM7SUFDOUQsQ0FBQyxDQUFDO0VBQ0o7RUFDQTtFQUNBLElBQUk5QixNQUFNLENBQUNVLGtCQUFrQixFQUFFO0lBQzdCLElBQUFJLGVBQU8sRUFBQ2QsTUFBTSxDQUFDVSxrQkFBa0IsQ0FBQyxDQUFDSyxPQUFPLENBQUVXLE1BQU0sSUFBSztNQUNyRCxJQUFJQyxFQUFFLEdBQUcsSUFBQWIsZUFBTyxFQUFDWSxNQUFNLENBQUNDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQztNQUM5QixJQUFJSSxLQUFLLEdBQUcsSUFBQWpCLGVBQU8sRUFBQ1ksTUFBTSxDQUFDSyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUM7TUFDcEMsSUFBSUYsS0FBSyxHQUFHakIsU0FBUyxDQUFDYyxNQUFNLENBQUNHLEtBQUssQ0FBQztNQUNuQyxJQUFJQyxNQUFNLEdBQUdaLGNBQWMsQ0FBQ1EsTUFBTSxDQUFDSSxNQUFNLENBQUM7TUFDMUNqQyxNQUFNLENBQUNhLGtCQUFrQixDQUFDTyxJQUFJLENBQUM7UUFBRVUsRUFBRTtRQUFFSSxLQUFLO1FBQUVGLEtBQUs7UUFBRUM7TUFBTyxDQUFDLENBQUM7SUFDOUQsQ0FBQyxDQUFDO0VBQ0o7RUFDQTtFQUNBLElBQUk5QixNQUFNLENBQUNXLDBCQUEwQixFQUFFO0lBQ3JDLElBQUFHLGVBQU8sRUFBQ2QsTUFBTSxDQUFDVywwQkFBMEIsQ0FBQyxDQUFDSSxPQUFPLENBQUVXLE1BQU0sSUFBSztNQUM3RCxJQUFJQyxFQUFFLEdBQUcsSUFBQWIsZUFBTyxFQUFDWSxNQUFNLENBQUNDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQztNQUM5QixJQUFJSyxhQUFhLEdBQUcsSUFBQWxCLGVBQU8sRUFBQ1ksTUFBTSxDQUFDTSxhQUFhLENBQUMsQ0FBQyxDQUFDLENBQUM7TUFDcEQsSUFBSUgsS0FBSyxHQUFHakIsU0FBUyxDQUFDYyxNQUFNLENBQUNHLEtBQUssQ0FBQztNQUNuQyxJQUFJQyxNQUFNLEdBQUdaLGNBQWMsQ0FBQ1EsTUFBTSxDQUFDSSxNQUFNLENBQUM7TUFDMUNqQyxNQUFNLENBQUNjLDBCQUEwQixDQUFDTSxJQUFJLENBQUM7UUFBRVUsRUFBRTtRQUFFSyxhQUFhO1FBQUVILEtBQUs7UUFBRUM7TUFBTyxDQUFDLENBQUM7SUFDOUUsQ0FBQyxDQUFDO0VBQ0o7RUFFQSxPQUFPakMsTUFBTTtBQUNmO0FBRUEsTUFBTW9DLGFBQWEsR0FBR0EsQ0FBQ0MsT0FBTyxFQUFFQyxJQUFJLEdBQUcsQ0FBQyxDQUFDLEtBQUs7RUFDNUMsSUFBSTtJQUFFQyxHQUFHO0lBQUU5QixZQUFZO0lBQUVGLElBQUk7SUFBRWlDLElBQUk7SUFBRUMsU0FBUztJQUFFQztFQUFTLENBQUMsR0FBR0wsT0FBTztFQUVwRSxJQUFJLENBQUMsSUFBQU0sZ0JBQVEsRUFBQ0wsSUFBSSxDQUFDLEVBQUU7SUFDbkJBLElBQUksR0FBRyxDQUFDLENBQUM7RUFDWDtFQUVBLE1BQU1NLElBQUksR0FBRyxJQUFBQyx5QkFBaUIsRUFBQyxJQUFBNUIsZUFBTyxFQUFDc0IsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7RUFDL0MsTUFBTXJDLFlBQVksR0FBRyxJQUFJUSxJQUFJLENBQUMsSUFBQU8sZUFBTyxFQUFDUixZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztFQUN2RCxNQUFNUixJQUFJLEdBQUcsSUFBQTZDLG9CQUFZLEVBQUMsSUFBQTdCLGVBQU8sRUFBQ1YsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7RUFDM0MsTUFBTXdDLElBQUksR0FBRyxJQUFBQyxvQkFBWSxFQUFDUixJQUFJLENBQUM7RUFFL0IsT0FBTztJQUNMSSxJQUFJO0lBQ0oxQyxZQUFZO0lBQ1pELElBQUk7SUFDSjhDLElBQUk7SUFDSkUsU0FBUyxFQUFFUixTQUFTO0lBQ3BCUyxRQUFRLEVBQUVSLFFBQVE7SUFDbEJTLGNBQWMsRUFBRWIsSUFBSSxDQUFDYyxjQUFjLEdBQUdkLElBQUksQ0FBQ2MsY0FBYyxHQUFHO0VBQzlELENBQUM7QUFDSCxDQUFDOztBQUVEO0FBQ08sU0FBU0MsZ0JBQWdCQSxDQUFDdEQsR0FBRyxFQUFFO0VBQ3BDLElBQUlDLE1BQU0sR0FBRztJQUNYc0QsT0FBTyxFQUFFLEVBQUU7SUFDWEMsV0FBVyxFQUFFO0VBQ2YsQ0FBQztFQUNELElBQUlBLFdBQVcsR0FBRyxLQUFLO0VBQ3ZCLElBQUlDLFVBQVUsRUFBRUMsb0JBQW9CO0VBQ3BDLE1BQU10RCxNQUFNLEdBQUdULG1CQUFtQixDQUFDZ0UsS0FBSyxDQUFDM0QsR0FBRyxDQUFDO0VBRTdDLE1BQU00RCx5QkFBeUIsR0FBSUMsY0FBYyxJQUFLO0lBQ3BELElBQUlBLGNBQWMsRUFBRTtNQUNsQixJQUFBM0MsZUFBTyxFQUFDMkMsY0FBYyxDQUFDLENBQUMxQyxPQUFPLENBQUUyQyxZQUFZLElBQUs7UUFDaEQ3RCxNQUFNLENBQUNzRCxPQUFPLENBQUNsQyxJQUFJLENBQUM7VUFBRTBDLE1BQU0sRUFBRSxJQUFBakIseUJBQWlCLEVBQUMsSUFBQTVCLGVBQU8sRUFBQzRDLFlBQVksQ0FBQ0UsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7VUFBRWhCLElBQUksRUFBRTtRQUFFLENBQUMsQ0FBQztNQUM5RixDQUFDLENBQUM7SUFDSjtFQUNGLENBQUM7RUFFRCxNQUFNaUIsZ0JBQWdCLEdBQUc3RCxNQUFNLENBQUM4RCxnQkFBZ0I7RUFDaEQsTUFBTUMsa0JBQWtCLEdBQUcvRCxNQUFNLENBQUNnRSxrQkFBa0I7RUFFcEQsSUFBSUgsZ0JBQWdCLEVBQUU7SUFDcEIsSUFBSUEsZ0JBQWdCLENBQUNJLFdBQVcsRUFBRTtNQUNoQ2IsV0FBVyxHQUFHUyxnQkFBZ0IsQ0FBQ0ksV0FBVztJQUM1QztJQUNBLElBQUlKLGdCQUFnQixDQUFDSyxRQUFRLEVBQUU7TUFDN0IsSUFBQXBELGVBQU8sRUFBQytDLGdCQUFnQixDQUFDSyxRQUFRLENBQUMsQ0FBQ25ELE9BQU8sQ0FBRW1CLE9BQU8sSUFBSztRQUN0RCxNQUFNTyxJQUFJLEdBQUcsSUFBQUMseUJBQWlCLEVBQUMsSUFBQTVCLGVBQU8sRUFBQ29CLE9BQU8sQ0FBQ0UsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDdkQsTUFBTXJDLFlBQVksR0FBRyxJQUFJUSxJQUFJLENBQUMsSUFBQU8sZUFBTyxFQUFDb0IsT0FBTyxDQUFDNUIsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDL0QsTUFBTVIsSUFBSSxHQUFHLElBQUE2QyxvQkFBWSxFQUFDLElBQUE3QixlQUFPLEVBQUNvQixPQUFPLENBQUM5QixJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUNuRCxNQUFNd0MsSUFBSSxHQUFHLElBQUFDLG9CQUFZLEVBQUNYLE9BQU8sQ0FBQ0csSUFBSSxDQUFDO1FBQ3ZDeEMsTUFBTSxDQUFDc0QsT0FBTyxDQUFDbEMsSUFBSSxDQUFDO1VBQUV3QixJQUFJO1VBQUUxQyxZQUFZO1VBQUVELElBQUk7VUFBRThDO1FBQUssQ0FBQyxDQUFDO01BQ3pELENBQUMsQ0FBQztJQUNKO0lBRUEsSUFBSWlCLGdCQUFnQixDQUFDTSxVQUFVLEVBQUU7TUFDL0JkLFVBQVUsR0FBR1EsZ0JBQWdCLENBQUNNLFVBQVU7SUFDMUM7SUFDQVgseUJBQXlCLENBQUNLLGdCQUFnQixDQUFDTyxjQUFjLENBQUM7RUFDNUQ7RUFFQSxJQUFJTCxrQkFBa0IsRUFBRTtJQUN0QixJQUFJQSxrQkFBa0IsQ0FBQ0UsV0FBVyxFQUFFO01BQ2xDYixXQUFXLEdBQUdXLGtCQUFrQixDQUFDRSxXQUFXO0lBQzlDO0lBRUEsSUFBSUYsa0JBQWtCLENBQUNNLE9BQU8sRUFBRTtNQUM5QixJQUFBdkQsZUFBTyxFQUFDaUQsa0JBQWtCLENBQUNNLE9BQU8sQ0FBQyxDQUFDdEQsT0FBTyxDQUFFbUIsT0FBTyxJQUFLO1FBQ3ZEckMsTUFBTSxDQUFDc0QsT0FBTyxDQUFDbEMsSUFBSSxDQUFDZ0IsYUFBYSxDQUFDQyxPQUFPLENBQUMsQ0FBQztNQUM3QyxDQUFDLENBQUM7SUFDSjtJQUNBLElBQUk2QixrQkFBa0IsQ0FBQ08sWUFBWSxFQUFFO01BQ25DLElBQUF4RCxlQUFPLEVBQUNpRCxrQkFBa0IsQ0FBQ08sWUFBWSxDQUFDLENBQUN2RCxPQUFPLENBQUVtQixPQUFPLElBQUs7UUFDNURyQyxNQUFNLENBQUNzRCxPQUFPLENBQUNsQyxJQUFJLENBQUNnQixhQUFhLENBQUNDLE9BQU8sRUFBRTtVQUFFZSxjQUFjLEVBQUU7UUFBSyxDQUFDLENBQUMsQ0FBQztNQUN2RSxDQUFDLENBQUM7SUFDSjtJQUVBLElBQUljLGtCQUFrQixDQUFDUSxhQUFhLEVBQUU7TUFDcENqQixvQkFBb0IsR0FBR1Msa0JBQWtCLENBQUNRLGFBQWE7SUFDekQ7SUFDQSxJQUFJUixrQkFBa0IsQ0FBQ1MsbUJBQW1CLEVBQUU7TUFDMUMzRSxNQUFNLENBQUM0RSxlQUFlLEdBQUdWLGtCQUFrQixDQUFDUyxtQkFBbUI7SUFDakU7SUFDQWhCLHlCQUF5QixDQUFDTyxrQkFBa0IsQ0FBQ0ssY0FBYyxDQUFDO0VBQzlEO0VBRUF2RSxNQUFNLENBQUN1RCxXQUFXLEdBQUdBLFdBQVc7RUFDaEMsSUFBSUEsV0FBVyxFQUFFO0lBQ2Z2RCxNQUFNLENBQUN3RCxVQUFVLEdBQUdDLG9CQUFvQixJQUFJRCxVQUFVO0VBQ3hEO0VBQ0EsT0FBT3hELE1BQU07QUFDZjs7QUFFQTtBQUNPLFNBQVM2RSxrQkFBa0JBLENBQUM5RSxHQUFHLEVBQUU7RUFDdEMsSUFBSUMsTUFBTSxHQUFHO0lBQ1hzRCxPQUFPLEVBQUUsRUFBRTtJQUNYQyxXQUFXLEVBQUU7RUFDZixDQUFDO0VBQ0QsSUFBSXBELE1BQU0sR0FBRyxJQUFBQyxnQkFBUSxFQUFDTCxHQUFHLENBQUM7RUFDMUIsSUFBSSxDQUFDSSxNQUFNLENBQUM4RCxnQkFBZ0IsRUFBRTtJQUM1QixNQUFNLElBQUlqRyxNQUFNLENBQUNzQyxlQUFlLENBQUMsaUNBQWlDLENBQUM7RUFDckU7RUFDQUgsTUFBTSxHQUFHQSxNQUFNLENBQUM4RCxnQkFBZ0I7RUFDaEMsSUFBSTlELE1BQU0sQ0FBQ2lFLFdBQVcsRUFBRTtJQUN0QnBFLE1BQU0sQ0FBQ3VELFdBQVcsR0FBR3BELE1BQU0sQ0FBQ2lFLFdBQVc7RUFDekM7RUFDQSxJQUFJakUsTUFBTSxDQUFDMkUscUJBQXFCLEVBQUU7SUFDaEM5RSxNQUFNLENBQUMrRSxxQkFBcUIsR0FBRzVFLE1BQU0sQ0FBQzJFLHFCQUFxQjtFQUM3RDtFQUNBLElBQUkzRSxNQUFNLENBQUNrRSxRQUFRLEVBQUU7SUFDbkIsSUFBQXBELGVBQU8sRUFBQ2QsTUFBTSxDQUFDa0UsUUFBUSxDQUFDLENBQUNuRCxPQUFPLENBQUVtQixPQUFPLElBQUs7TUFDNUMsSUFBSU8sSUFBSSxHQUFHLElBQUFDLHlCQUFpQixFQUFDLElBQUE1QixlQUFPLEVBQUNvQixPQUFPLENBQUNFLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO01BQ3JELElBQUlyQyxZQUFZLEdBQUcsSUFBSVEsSUFBSSxDQUFDMkIsT0FBTyxDQUFDNUIsWUFBWSxDQUFDO01BQ2pELElBQUlSLElBQUksR0FBRyxJQUFBNkMsb0JBQVksRUFBQ1QsT0FBTyxDQUFDOUIsSUFBSSxDQUFDO01BQ3JDLElBQUl3QyxJQUFJLEdBQUdWLE9BQU8sQ0FBQ0csSUFBSTtNQUN2QnhDLE1BQU0sQ0FBQ3NELE9BQU8sQ0FBQ2xDLElBQUksQ0FBQztRQUFFd0IsSUFBSTtRQUFFMUMsWUFBWTtRQUFFRCxJQUFJO1FBQUU4QztNQUFLLENBQUMsQ0FBQztJQUN6RCxDQUFDLENBQUM7RUFDSjtFQUNBLElBQUk1QyxNQUFNLENBQUNvRSxjQUFjLEVBQUU7SUFDekIsSUFBQXRELGVBQU8sRUFBQ2QsTUFBTSxDQUFDb0UsY0FBYyxDQUFDLENBQUNyRCxPQUFPLENBQUUyQyxZQUFZLElBQUs7TUFDdkQ3RCxNQUFNLENBQUNzRCxPQUFPLENBQUNsQyxJQUFJLENBQUM7UUFBRTBDLE1BQU0sRUFBRSxJQUFBakIseUJBQWlCLEVBQUMsSUFBQTVCLGVBQU8sRUFBQzRDLFlBQVksQ0FBQ0UsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFBRWhCLElBQUksRUFBRTtNQUFFLENBQUMsQ0FBQztJQUM5RixDQUFDLENBQUM7RUFDSjtFQUNBLE9BQU8vQyxNQUFNO0FBQ2Y7O0FBRUE7QUFDTyxTQUFTZ0YsOEJBQThCQSxDQUFDakYsR0FBRyxFQUFFO0VBQ2xELElBQUlDLE1BQU0sR0FBRztJQUNYc0QsT0FBTyxFQUFFLEVBQUU7SUFDWEMsV0FBVyxFQUFFO0VBQ2YsQ0FBQztFQUNELElBQUlwRCxNQUFNLEdBQUcsSUFBQUMsZ0JBQVEsRUFBQ0wsR0FBRyxDQUFDO0VBQzFCLElBQUksQ0FBQ0ksTUFBTSxDQUFDOEQsZ0JBQWdCLEVBQUU7SUFDNUIsTUFBTSxJQUFJakcsTUFBTSxDQUFDc0MsZUFBZSxDQUFDLGlDQUFpQyxDQUFDO0VBQ3JFO0VBQ0FILE1BQU0sR0FBR0EsTUFBTSxDQUFDOEQsZ0JBQWdCO0VBQ2hDLElBQUk5RCxNQUFNLENBQUNpRSxXQUFXLEVBQUU7SUFDdEJwRSxNQUFNLENBQUN1RCxXQUFXLEdBQUdwRCxNQUFNLENBQUNpRSxXQUFXO0VBQ3pDO0VBQ0EsSUFBSWpFLE1BQU0sQ0FBQzJFLHFCQUFxQixFQUFFO0lBQ2hDOUUsTUFBTSxDQUFDK0UscUJBQXFCLEdBQUc1RSxNQUFNLENBQUMyRSxxQkFBcUI7RUFDN0Q7RUFFQSxJQUFJM0UsTUFBTSxDQUFDa0UsUUFBUSxFQUFFO0lBQ25CLElBQUFwRCxlQUFPLEVBQUNkLE1BQU0sQ0FBQ2tFLFFBQVEsQ0FBQyxDQUFDbkQsT0FBTyxDQUFFbUIsT0FBTyxJQUFLO01BQzVDLElBQUlPLElBQUksR0FBRyxJQUFBQyx5QkFBaUIsRUFBQ1IsT0FBTyxDQUFDRSxHQUFHLENBQUM7TUFDekMsSUFBSXJDLFlBQVksR0FBRyxJQUFJUSxJQUFJLENBQUMyQixPQUFPLENBQUM1QixZQUFZLENBQUM7TUFDakQsSUFBSVIsSUFBSSxHQUFHLElBQUE2QyxvQkFBWSxFQUFDVCxPQUFPLENBQUM5QixJQUFJLENBQUM7TUFDckMsSUFBSXdDLElBQUksR0FBR1YsT0FBTyxDQUFDRyxJQUFJO01BQ3ZCLElBQUl5QyxRQUFRO01BQ1osSUFBSTVDLE9BQU8sQ0FBQzZDLFlBQVksSUFBSSxJQUFJLEVBQUU7UUFDaENELFFBQVEsR0FBRyxJQUFBaEUsZUFBTyxFQUFDb0IsT0FBTyxDQUFDNkMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDO01BQzdDLENBQUMsTUFBTTtRQUNMRCxRQUFRLEdBQUcsSUFBSTtNQUNqQjtNQUNBakYsTUFBTSxDQUFDc0QsT0FBTyxDQUFDbEMsSUFBSSxDQUFDO1FBQUV3QixJQUFJO1FBQUUxQyxZQUFZO1FBQUVELElBQUk7UUFBRThDLElBQUk7UUFBRWtDO01BQVMsQ0FBQyxDQUFDO0lBQ25FLENBQUMsQ0FBQztFQUNKO0VBRUEsSUFBSTlFLE1BQU0sQ0FBQ29FLGNBQWMsRUFBRTtJQUN6QixJQUFBdEQsZUFBTyxFQUFDZCxNQUFNLENBQUNvRSxjQUFjLENBQUMsQ0FBQ3JELE9BQU8sQ0FBRTJDLFlBQVksSUFBSztNQUN2RDdELE1BQU0sQ0FBQ3NELE9BQU8sQ0FBQ2xDLElBQUksQ0FBQztRQUFFMEMsTUFBTSxFQUFFLElBQUFqQix5QkFBaUIsRUFBQyxJQUFBNUIsZUFBTyxFQUFDNEMsWUFBWSxDQUFDRSxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUFFaEIsSUFBSSxFQUFFO01BQUUsQ0FBQyxDQUFDO0lBQzlGLENBQUMsQ0FBQztFQUNKO0VBQ0EsT0FBTy9DLE1BQU07QUFDZjtBQUVPLFNBQVNtRixvQkFBb0JBLENBQUNwRixHQUFHLEVBQUU7RUFDeEMsTUFBTXFGLE1BQU0sR0FBRyxJQUFBaEYsZ0JBQVEsRUFBQ0wsR0FBRyxDQUFDO0VBQzVCLE9BQU9xRixNQUFNLENBQUNDLHNCQUFzQjtBQUN0QztBQUNPLFNBQVNDLDBCQUEwQkEsQ0FBQ3ZGLEdBQUcsRUFBRTtFQUM5QyxNQUFNcUYsTUFBTSxHQUFHLElBQUFoRixnQkFBUSxFQUFDTCxHQUFHLENBQUM7RUFDNUIsTUFBTXdGLGVBQWUsR0FBR0gsTUFBTSxDQUFDSSxTQUFTO0VBRXhDLE9BQU87SUFDTEMsSUFBSSxFQUFFRixlQUFlLENBQUNHLElBQUk7SUFDMUJDLGVBQWUsRUFBRUosZUFBZSxDQUFDSztFQUNuQyxDQUFDO0FBQ0g7QUFFTyxTQUFTQywyQkFBMkJBLENBQUM5RixHQUFHLEVBQUU7RUFDL0MsSUFBSStGLFNBQVMsR0FBRyxJQUFBMUYsZ0JBQVEsRUFBQ0wsR0FBRyxDQUFDO0VBQzdCLE9BQU8rRixTQUFTO0FBQ2xCO0FBRU8sU0FBU0MsMEJBQTBCQSxDQUFDaEcsR0FBRyxFQUFFO0VBQzlDLE1BQU1xRixNQUFNLEdBQUcsSUFBQWhGLGdCQUFRLEVBQUNMLEdBQUcsQ0FBQztFQUM1QixPQUFPcUYsTUFBTSxDQUFDWSxTQUFTO0FBQ3pCO0FBRU8sU0FBU0MsZ0JBQWdCQSxDQUFDbEcsR0FBRyxFQUFFO0VBQ3BDLE1BQU1xRixNQUFNLEdBQUcsSUFBQWhGLGdCQUFRLEVBQUNMLEdBQUcsQ0FBQztFQUM1QixNQUFNbUcsTUFBTSxHQUFHZCxNQUFNLENBQUNlLGNBQWM7RUFDcEMsT0FBT0QsTUFBTTtBQUNmO0FBRU8sU0FBU0UsbUJBQW1CQSxDQUFDckcsR0FBRyxFQUFFO0VBQ3ZDLE1BQU1xRixNQUFNLEdBQUcsSUFBQWhGLGdCQUFRLEVBQUNMLEdBQUcsQ0FBQztFQUM1QixJQUFJcUYsTUFBTSxDQUFDaUIsWUFBWSxJQUFJakIsTUFBTSxDQUFDaUIsWUFBWSxDQUFDQyxLQUFLLEVBQUU7SUFDcEQ7SUFDQSxPQUFPLElBQUFyRixlQUFPLEVBQUNtRSxNQUFNLENBQUNpQixZQUFZLENBQUNDLEtBQUssQ0FBQztFQUMzQztFQUNBLE9BQU8sRUFBRTtBQUNYO0FBRU8sU0FBU0MsZ0NBQWdDQSxDQUFDQyxHQUFHLEVBQUU7RUFDcEQ7RUFDQSxTQUFTQyxpQkFBaUJBLENBQUNDLE1BQU0sRUFBRTtJQUNqQyxNQUFNQyxhQUFhLEdBQUdDLE1BQU0sQ0FBQ0MsSUFBSSxDQUFDSCxNQUFNLENBQUNJLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDQyxTQUFTLENBQUMsQ0FBQztJQUM3RCxNQUFNQyx1QkFBdUIsR0FBR0osTUFBTSxDQUFDQyxJQUFJLENBQUNILE1BQU0sQ0FBQ0ksSUFBSSxDQUFDSCxhQUFhLENBQUMsQ0FBQyxDQUFDTSxRQUFRLENBQUMsQ0FBQztJQUNsRixNQUFNQyxnQkFBZ0IsR0FBRyxDQUFDRix1QkFBdUIsSUFBSSxFQUFFLEVBQUVHLEtBQUssQ0FBQyxHQUFHLENBQUM7SUFDbkUsTUFBTUMsVUFBVSxHQUFHRixnQkFBZ0IsQ0FBQ0csTUFBTSxJQUFJLENBQUMsR0FBR0gsZ0JBQWdCLENBQUMsQ0FBQyxDQUFDLEdBQUcsRUFBRTtJQUMxRSxPQUFPRSxVQUFVO0VBQ25CO0VBRUEsU0FBU0Usa0JBQWtCQSxDQUFDWixNQUFNLEVBQUU7SUFDbEMsTUFBTWEsT0FBTyxHQUFHWCxNQUFNLENBQUNDLElBQUksQ0FBQ0gsTUFBTSxDQUFDSSxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQ1UsWUFBWSxDQUFDLENBQUM7SUFDMUQsTUFBTUMsUUFBUSxHQUFHYixNQUFNLENBQUNDLElBQUksQ0FBQ0gsTUFBTSxDQUFDSSxJQUFJLENBQUNTLE9BQU8sQ0FBQyxDQUFDLENBQUNOLFFBQVEsQ0FBQyxDQUFDO0lBQzdELE9BQU9RLFFBQVE7RUFDakI7RUFFQSxNQUFNQyxhQUFhLEdBQUcsSUFBSUMsc0JBQWEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFDOztFQUU1QyxNQUFNQyxjQUFjLEdBQUcsSUFBQUMsc0JBQWMsRUFBQ3JCLEdBQUcsQ0FBQyxFQUFDO0VBQzNDLE9BQU9vQixjQUFjLENBQUNFLGNBQWMsQ0FBQ1QsTUFBTSxFQUFFO0lBQzNDO0lBQ0EsSUFBSVUsaUJBQWlCLEVBQUM7O0lBRXRCLE1BQU1DLHFCQUFxQixHQUFHcEIsTUFBTSxDQUFDQyxJQUFJLENBQUNlLGNBQWMsQ0FBQ2QsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ2pFaUIsaUJBQWlCLEdBQUdFLFVBQUssQ0FBQ0QscUJBQXFCLENBQUM7SUFFaEQsTUFBTUUsaUJBQWlCLEdBQUd0QixNQUFNLENBQUNDLElBQUksQ0FBQ2UsY0FBYyxDQUFDZCxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDN0RpQixpQkFBaUIsR0FBR0UsVUFBSyxDQUFDQyxpQkFBaUIsRUFBRUgsaUJBQWlCLENBQUM7SUFFL0QsTUFBTUksb0JBQW9CLEdBQUdKLGlCQUFpQixDQUFDSyxXQUFXLENBQUMsQ0FBQyxFQUFDOztJQUU3RCxNQUFNQyxnQkFBZ0IsR0FBR3pCLE1BQU0sQ0FBQ0MsSUFBSSxDQUFDZSxjQUFjLENBQUNkLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFDO0lBQzdEaUIsaUJBQWlCLEdBQUdFLFVBQUssQ0FBQ0ksZ0JBQWdCLEVBQUVOLGlCQUFpQixDQUFDO0lBRTlELE1BQU1PLGNBQWMsR0FBR04scUJBQXFCLENBQUNJLFdBQVcsQ0FBQyxDQUFDO0lBQzFELE1BQU1HLFlBQVksR0FBR0wsaUJBQWlCLENBQUNFLFdBQVcsQ0FBQyxDQUFDO0lBQ3BELE1BQU1JLG1CQUFtQixHQUFHSCxnQkFBZ0IsQ0FBQ0QsV0FBVyxDQUFDLENBQUM7SUFFMUQsSUFBSUksbUJBQW1CLEtBQUtMLG9CQUFvQixFQUFFO01BQ2hEO01BQ0EsTUFBTSxJQUFJN0IsS0FBSyxDQUNaLDRDQUEyQ2tDLG1CQUFvQixtQ0FBa0NMLG9CQUFxQixFQUN6SCxDQUFDO0lBQ0g7SUFFQSxNQUFNTSxPQUFPLEdBQUcsQ0FBQyxDQUFDO0lBQ2xCLElBQUlGLFlBQVksR0FBRyxDQUFDLEVBQUU7TUFDcEIsTUFBTUcsV0FBVyxHQUFHOUIsTUFBTSxDQUFDQyxJQUFJLENBQUNlLGNBQWMsQ0FBQ2QsSUFBSSxDQUFDeUIsWUFBWSxDQUFDLENBQUM7TUFDbEVSLGlCQUFpQixHQUFHRSxVQUFLLENBQUNTLFdBQVcsRUFBRVgsaUJBQWlCLENBQUM7TUFDekQsTUFBTVksa0JBQWtCLEdBQUcsSUFBQWQsc0JBQWMsRUFBQ2EsV0FBVyxDQUFDO01BQ3RELE9BQU9DLGtCQUFrQixDQUFDYixjQUFjLENBQUNULE1BQU0sRUFBRTtRQUMvQyxJQUFJdUIsY0FBYyxHQUFHbkMsaUJBQWlCLENBQUNrQyxrQkFBa0IsQ0FBQztRQUMxREEsa0JBQWtCLENBQUM3QixJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUM7UUFDM0IyQixPQUFPLENBQUNHLGNBQWMsQ0FBQyxHQUFHdEIsa0JBQWtCLENBQUNxQixrQkFBa0IsQ0FBQztNQUNsRTtJQUNGO0lBRUEsSUFBSUUsYUFBYTtJQUNqQixNQUFNQyxhQUFhLEdBQUdSLGNBQWMsR0FBR0MsWUFBWSxHQUFHLEVBQUU7SUFDeEQsSUFBSU8sYUFBYSxHQUFHLENBQUMsRUFBRTtNQUNyQixNQUFNQyxhQUFhLEdBQUduQyxNQUFNLENBQUNDLElBQUksQ0FBQ2UsY0FBYyxDQUFDZCxJQUFJLENBQUNnQyxhQUFhLENBQUMsQ0FBQztNQUNyRWYsaUJBQWlCLEdBQUdFLFVBQUssQ0FBQ2MsYUFBYSxFQUFFaEIsaUJBQWlCLENBQUM7TUFDM0Q7TUFDQSxNQUFNaUIsbUJBQW1CLEdBQUdwQyxNQUFNLENBQUNDLElBQUksQ0FBQ2UsY0FBYyxDQUFDZCxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQ3NCLFdBQVcsQ0FBQyxDQUFDO01BQzdFLE1BQU1hLGFBQWEsR0FBR2xCLGlCQUFpQixDQUFDSyxXQUFXLENBQUMsQ0FBQztNQUNyRDtNQUNBLElBQUlZLG1CQUFtQixLQUFLQyxhQUFhLEVBQUU7UUFDekMsTUFBTSxJQUFJM0MsS0FBSyxDQUNaLDZDQUE0QzBDLG1CQUFvQixtQ0FBa0NDLGFBQWMsRUFDbkgsQ0FBQztNQUNIO01BQ0FKLGFBQWEsR0FBRyxJQUFBaEIsc0JBQWMsRUFBQ2tCLGFBQWEsQ0FBQztJQUMvQztJQUVBLE1BQU1HLFdBQVcsR0FBR1QsT0FBTyxDQUFDLGNBQWMsQ0FBQztJQUUzQyxRQUFRUyxXQUFXO01BQ2pCLEtBQUssT0FBTztRQUFFO1VBQ1osTUFBTUMsWUFBWSxHQUFHVixPQUFPLENBQUMsWUFBWSxDQUFDLEdBQUcsSUFBSSxHQUFHQSxPQUFPLENBQUMsZUFBZSxDQUFDLEdBQUcsR0FBRztVQUNsRixNQUFNLElBQUluQyxLQUFLLENBQUM2QyxZQUFZLENBQUM7UUFDL0I7TUFDQSxLQUFLLE9BQU87UUFBRTtVQUNaLE1BQU1DLFdBQVcsR0FBR1gsT0FBTyxDQUFDLGNBQWMsQ0FBQztVQUMzQyxNQUFNWSxTQUFTLEdBQUdaLE9BQU8sQ0FBQyxZQUFZLENBQUM7VUFFdkMsUUFBUVksU0FBUztZQUNmLEtBQUssS0FBSztjQUFFO2dCQUNWM0IsYUFBYSxDQUFDNEIsV0FBVyxDQUFDOUMsR0FBRyxDQUFDO2dCQUM5QixPQUFPa0IsYUFBYTtjQUN0QjtZQUVBLEtBQUssU0FBUztjQUFFO2dCQUNkLE1BQU02QixRQUFRLEdBQUdWLGFBQWEsQ0FBQy9CLElBQUksQ0FBQ2dDLGFBQWEsQ0FBQztnQkFDbERwQixhQUFhLENBQUM4QixVQUFVLENBQUNELFFBQVEsQ0FBQztnQkFDbEM7Y0FDRjtZQUVBLEtBQUssVUFBVTtjQUNiO2dCQUNFLFFBQVFILFdBQVc7a0JBQ2pCLEtBQUssVUFBVTtvQkFBRTtzQkFDZixNQUFNSyxZQUFZLEdBQUdaLGFBQWEsQ0FBQy9CLElBQUksQ0FBQ2dDLGFBQWEsQ0FBQztzQkFDdERwQixhQUFhLENBQUNnQyxXQUFXLENBQUNELFlBQVksQ0FBQ3hDLFFBQVEsQ0FBQyxDQUFDLENBQUM7c0JBQ2xEO29CQUNGO2tCQUNBO29CQUFTO3NCQUNQLE1BQU1rQyxZQUFZLEdBQUksMkJBQTBCQyxXQUFZLCtCQUE4QjtzQkFDMUYsTUFBTSxJQUFJOUMsS0FBSyxDQUFDNkMsWUFBWSxDQUFDO29CQUMvQjtnQkFDRjtjQUNGO2NBQ0E7WUFDRixLQUFLLE9BQU87Y0FDVjtnQkFDRSxRQUFRQyxXQUFXO2tCQUNqQixLQUFLLFVBQVU7b0JBQUU7c0JBQ2YsTUFBTU8sU0FBUyxHQUFHZCxhQUFhLENBQUMvQixJQUFJLENBQUNnQyxhQUFhLENBQUM7c0JBQ25EcEIsYUFBYSxDQUFDa0MsUUFBUSxDQUFDRCxTQUFTLENBQUMxQyxRQUFRLENBQUMsQ0FBQyxDQUFDO3NCQUM1QztvQkFDRjtrQkFDQTtvQkFBUztzQkFDUCxNQUFNa0MsWUFBWSxHQUFJLDJCQUEwQkMsV0FBWSw0QkFBMkI7c0JBQ3ZGLE1BQU0sSUFBSTlDLEtBQUssQ0FBQzZDLFlBQVksQ0FBQztvQkFDL0I7Z0JBQ0Y7Y0FDRjtjQUNBO1lBQ0Y7Y0FBUztnQkFDUDtnQkFDQTtnQkFDQSxNQUFNVSxjQUFjLEdBQUksa0NBQWlDWCxXQUFZLEdBQUU7Z0JBQ3ZFO2dCQUNBWSxPQUFPLENBQUNDLElBQUksQ0FBQ0YsY0FBYyxDQUFDO2NBQzlCO1VBQ0YsQ0FBQyxDQUFDO1FBQ0o7TUFBRTtJQUNKLENBQUMsQ0FBQztFQUNKLENBQUMsQ0FBQztBQUNKIn0=