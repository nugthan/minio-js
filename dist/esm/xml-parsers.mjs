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

import crc32 from 'buffer-crc32';
import { XMLParser } from 'fast-xml-parser';
import * as errors from "./errors.mjs";
import { SelectResults } from "./helpers.mjs";
import { isObject, parseXml, readableStream, sanitizeETag, sanitizeObjectKey, sanitizeSize, toArray } from "./internal/helper.mjs";
const fxpWithoutNumParser = new XMLParser({
  numberParseOptions: {
    skipLike: /./
  }
});

// parse XML response for copy object
export function parseCopyObject(xml) {
  var result = {
    etag: '',
    lastModified: ''
  };
  var xmlobj = parseXml(xml);
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
export function parseBucketNotification(xml) {
  var result = {
    TopicConfiguration: [],
    QueueConfiguration: [],
    CloudFunctionConfiguration: []
  };
  // Parse the events list
  var genEvents = function (events) {
    var result = [];
    if (events) {
      toArray(events).forEach(s3event => {
        result.push(s3event);
      });
    }
    return result;
  };
  // Parse all filter rules
  var genFilterRules = function (filters) {
    var result = [];
    if (filters) {
      filters = toArray(filters);
      if (filters[0].S3Key) {
        filters[0].S3Key = toArray(filters[0].S3Key);
        if (filters[0].S3Key[0].FilterRule) {
          toArray(filters[0].S3Key[0].FilterRule).forEach(rule => {
            var Name = toArray(rule.Name)[0];
            var Value = toArray(rule.Value)[0];
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
  var xmlobj = parseXml(xml);
  xmlobj = xmlobj.NotificationConfiguration;

  // Parse all topic configurations in the xml
  if (xmlobj.TopicConfiguration) {
    toArray(xmlobj.TopicConfiguration).forEach(config => {
      var Id = toArray(config.Id)[0];
      var Topic = toArray(config.Topic)[0];
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
    toArray(xmlobj.QueueConfiguration).forEach(config => {
      var Id = toArray(config.Id)[0];
      var Queue = toArray(config.Queue)[0];
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
    toArray(xmlobj.CloudFunctionConfiguration).forEach(config => {
      var Id = toArray(config.Id)[0];
      var CloudFunction = toArray(config.CloudFunction)[0];
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
  if (!isObject(opts)) {
    opts = {};
  }
  const name = sanitizeObjectKey(toArray(Key)[0]);
  const lastModified = new Date(toArray(LastModified)[0]);
  const etag = sanitizeETag(toArray(ETag)[0]);
  const size = sanitizeSize(Size);
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
export function parseListObjects(xml) {
  var result = {
    objects: [],
    isTruncated: false
  };
  let isTruncated = false;
  let nextMarker, nextVersionKeyMarker;
  const xmlobj = fxpWithoutNumParser.parse(xml);
  const parseCommonPrefixesEntity = responseEntity => {
    if (responseEntity) {
      toArray(responseEntity).forEach(commonPrefix => {
        result.objects.push({
          prefix: sanitizeObjectKey(toArray(commonPrefix.Prefix)[0]),
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
      toArray(listBucketResult.Contents).forEach(content => {
        const name = sanitizeObjectKey(toArray(content.Key)[0]);
        const lastModified = new Date(toArray(content.LastModified)[0]);
        const etag = sanitizeETag(toArray(content.ETag)[0]);
        const size = sanitizeSize(content.Size);
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
      toArray(listVersionsResult.Version).forEach(content => {
        result.objects.push(formatObjInfo(content));
      });
    }
    if (listVersionsResult.DeleteMarker) {
      toArray(listVersionsResult.DeleteMarker).forEach(content => {
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
export function parseListObjectsV2(xml) {
  var result = {
    objects: [],
    isTruncated: false
  };
  var xmlobj = parseXml(xml);
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
    toArray(xmlobj.Contents).forEach(content => {
      var name = sanitizeObjectKey(toArray(content.Key)[0]);
      var lastModified = new Date(content.LastModified);
      var etag = sanitizeETag(content.ETag);
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
    toArray(xmlobj.CommonPrefixes).forEach(commonPrefix => {
      result.objects.push({
        prefix: sanitizeObjectKey(toArray(commonPrefix.Prefix)[0]),
        size: 0
      });
    });
  }
  return result;
}

// parse XML response for list objects v2 with metadata in a bucket
export function parseListObjectsV2WithMetadata(xml) {
  var result = {
    objects: [],
    isTruncated: false
  };
  var xmlobj = parseXml(xml);
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
    toArray(xmlobj.Contents).forEach(content => {
      var name = sanitizeObjectKey(content.Key);
      var lastModified = new Date(content.LastModified);
      var etag = sanitizeETag(content.ETag);
      var size = content.Size;
      var metadata;
      if (content.UserMetadata != null) {
        metadata = toArray(content.UserMetadata)[0];
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
    toArray(xmlobj.CommonPrefixes).forEach(commonPrefix => {
      result.objects.push({
        prefix: sanitizeObjectKey(toArray(commonPrefix.Prefix)[0]),
        size: 0
      });
    });
  }
  return result;
}
export function parseLifecycleConfig(xml) {
  const xmlObj = parseXml(xml);
  return xmlObj.LifecycleConfiguration;
}
export function parseObjectRetentionConfig(xml) {
  const xmlObj = parseXml(xml);
  const retentionConfig = xmlObj.Retention;
  return {
    mode: retentionConfig.Mode,
    retainUntilDate: retentionConfig.RetainUntilDate
  };
}
export function parseBucketEncryptionConfig(xml) {
  let encConfig = parseXml(xml);
  return encConfig;
}
export function parseObjectLegalHoldConfig(xml) {
  const xmlObj = parseXml(xml);
  return xmlObj.LegalHold;
}
export function uploadPartParser(xml) {
  const xmlObj = parseXml(xml);
  const respEl = xmlObj.CopyPartResult;
  return respEl;
}
export function removeObjectsParser(xml) {
  const xmlObj = parseXml(xml);
  if (xmlObj.DeleteResult && xmlObj.DeleteResult.Error) {
    // return errors as array always. as the response is object in case of single object passed in removeObjects
    return toArray(xmlObj.DeleteResult.Error);
  }
  return [];
}
export function parseSelectObjectContentResponse(res) {
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
  const selectResults = new SelectResults({}); // will be returned

  const responseStream = readableStream(res); // convert byte array to a readable responseStream
  while (responseStream._readableState.length) {
    // Top level responseStream read tracker.
    let msgCrcAccumulator; // accumulate from start of the message till the message crc start.

    const totalByteLengthBuffer = Buffer.from(responseStream.read(4));
    msgCrcAccumulator = crc32(totalByteLengthBuffer);
    const headerBytesBuffer = Buffer.from(responseStream.read(4));
    msgCrcAccumulator = crc32(headerBytesBuffer, msgCrcAccumulator);
    const calculatedPreludeCrc = msgCrcAccumulator.readInt32BE(); // use it to check if any CRC mismatch in header itself.

    const preludeCrcBuffer = Buffer.from(responseStream.read(4)); // read 4 bytes    i.e 4+4 =8 + 4 = 12 ( prelude + prelude crc)
    msgCrcAccumulator = crc32(preludeCrcBuffer, msgCrcAccumulator);
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
      msgCrcAccumulator = crc32(headerBytes, msgCrcAccumulator);
      const headerReaderStream = readableStream(headerBytes);
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
      msgCrcAccumulator = crc32(payLoadBuffer, msgCrcAccumulator);
      // read the checksum early and detect any mismatch so we can avoid unnecessary further processing.
      const messageCrcByteValue = Buffer.from(responseStream.read(4)).readInt32BE();
      const calculatedCrc = msgCrcAccumulator.readInt32BE();
      // Handle message CRC Error
      if (messageCrcByteValue !== calculatedCrc) {
        throw new Error(`Message Checksum Mismatch, Message CRC of ${messageCrcByteValue} does not equal expected CRC of ${calculatedCrc}`);
      }
      payloadStream = readableStream(payLoadBuffer);
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJjcmMzMiIsIlhNTFBhcnNlciIsImVycm9ycyIsIlNlbGVjdFJlc3VsdHMiLCJpc09iamVjdCIsInBhcnNlWG1sIiwicmVhZGFibGVTdHJlYW0iLCJzYW5pdGl6ZUVUYWciLCJzYW5pdGl6ZU9iamVjdEtleSIsInNhbml0aXplU2l6ZSIsInRvQXJyYXkiLCJmeHBXaXRob3V0TnVtUGFyc2VyIiwibnVtYmVyUGFyc2VPcHRpb25zIiwic2tpcExpa2UiLCJwYXJzZUNvcHlPYmplY3QiLCJ4bWwiLCJyZXN1bHQiLCJldGFnIiwibGFzdE1vZGlmaWVkIiwieG1sb2JqIiwiQ29weU9iamVjdFJlc3VsdCIsIkludmFsaWRYTUxFcnJvciIsIkVUYWciLCJyZXBsYWNlIiwiTGFzdE1vZGlmaWVkIiwiRGF0ZSIsInBhcnNlQnVja2V0Tm90aWZpY2F0aW9uIiwiVG9waWNDb25maWd1cmF0aW9uIiwiUXVldWVDb25maWd1cmF0aW9uIiwiQ2xvdWRGdW5jdGlvbkNvbmZpZ3VyYXRpb24iLCJnZW5FdmVudHMiLCJldmVudHMiLCJmb3JFYWNoIiwiczNldmVudCIsInB1c2giLCJnZW5GaWx0ZXJSdWxlcyIsImZpbHRlcnMiLCJTM0tleSIsIkZpbHRlclJ1bGUiLCJydWxlIiwiTmFtZSIsIlZhbHVlIiwiTm90aWZpY2F0aW9uQ29uZmlndXJhdGlvbiIsImNvbmZpZyIsIklkIiwiVG9waWMiLCJFdmVudCIsIkZpbHRlciIsIlF1ZXVlIiwiQ2xvdWRGdW5jdGlvbiIsImZvcm1hdE9iakluZm8iLCJjb250ZW50Iiwib3B0cyIsIktleSIsIlNpemUiLCJWZXJzaW9uSWQiLCJJc0xhdGVzdCIsIm5hbWUiLCJzaXplIiwidmVyc2lvbklkIiwiaXNMYXRlc3QiLCJpc0RlbGV0ZU1hcmtlciIsIklzRGVsZXRlTWFya2VyIiwicGFyc2VMaXN0T2JqZWN0cyIsIm9iamVjdHMiLCJpc1RydW5jYXRlZCIsIm5leHRNYXJrZXIiLCJuZXh0VmVyc2lvbktleU1hcmtlciIsInBhcnNlIiwicGFyc2VDb21tb25QcmVmaXhlc0VudGl0eSIsInJlc3BvbnNlRW50aXR5IiwiY29tbW9uUHJlZml4IiwicHJlZml4IiwiUHJlZml4IiwibGlzdEJ1Y2tldFJlc3VsdCIsIkxpc3RCdWNrZXRSZXN1bHQiLCJsaXN0VmVyc2lvbnNSZXN1bHQiLCJMaXN0VmVyc2lvbnNSZXN1bHQiLCJJc1RydW5jYXRlZCIsIkNvbnRlbnRzIiwiTmV4dE1hcmtlciIsIkNvbW1vblByZWZpeGVzIiwiVmVyc2lvbiIsIkRlbGV0ZU1hcmtlciIsIk5leHRLZXlNYXJrZXIiLCJOZXh0VmVyc2lvbklkTWFya2VyIiwidmVyc2lvbklkTWFya2VyIiwicGFyc2VMaXN0T2JqZWN0c1YyIiwiTmV4dENvbnRpbnVhdGlvblRva2VuIiwibmV4dENvbnRpbnVhdGlvblRva2VuIiwicGFyc2VMaXN0T2JqZWN0c1YyV2l0aE1ldGFkYXRhIiwibWV0YWRhdGEiLCJVc2VyTWV0YWRhdGEiLCJwYXJzZUxpZmVjeWNsZUNvbmZpZyIsInhtbE9iaiIsIkxpZmVjeWNsZUNvbmZpZ3VyYXRpb24iLCJwYXJzZU9iamVjdFJldGVudGlvbkNvbmZpZyIsInJldGVudGlvbkNvbmZpZyIsIlJldGVudGlvbiIsIm1vZGUiLCJNb2RlIiwicmV0YWluVW50aWxEYXRlIiwiUmV0YWluVW50aWxEYXRlIiwicGFyc2VCdWNrZXRFbmNyeXB0aW9uQ29uZmlnIiwiZW5jQ29uZmlnIiwicGFyc2VPYmplY3RMZWdhbEhvbGRDb25maWciLCJMZWdhbEhvbGQiLCJ1cGxvYWRQYXJ0UGFyc2VyIiwicmVzcEVsIiwiQ29weVBhcnRSZXN1bHQiLCJyZW1vdmVPYmplY3RzUGFyc2VyIiwiRGVsZXRlUmVzdWx0IiwiRXJyb3IiLCJwYXJzZVNlbGVjdE9iamVjdENvbnRlbnRSZXNwb25zZSIsInJlcyIsImV4dHJhY3RIZWFkZXJUeXBlIiwic3RyZWFtIiwiaGVhZGVyTmFtZUxlbiIsIkJ1ZmZlciIsImZyb20iLCJyZWFkIiwicmVhZFVJbnQ4IiwiaGVhZGVyTmFtZVdpdGhTZXBhcmF0b3IiLCJ0b1N0cmluZyIsInNwbGl0QnlTZXBhcmF0b3IiLCJzcGxpdCIsImhlYWRlck5hbWUiLCJsZW5ndGgiLCJleHRyYWN0SGVhZGVyVmFsdWUiLCJib2R5TGVuIiwicmVhZFVJbnQxNkJFIiwiYm9keU5hbWUiLCJzZWxlY3RSZXN1bHRzIiwicmVzcG9uc2VTdHJlYW0iLCJfcmVhZGFibGVTdGF0ZSIsIm1zZ0NyY0FjY3VtdWxhdG9yIiwidG90YWxCeXRlTGVuZ3RoQnVmZmVyIiwiaGVhZGVyQnl0ZXNCdWZmZXIiLCJjYWxjdWxhdGVkUHJlbHVkZUNyYyIsInJlYWRJbnQzMkJFIiwicHJlbHVkZUNyY0J1ZmZlciIsInRvdGFsTXNnTGVuZ3RoIiwiaGVhZGVyTGVuZ3RoIiwicHJlbHVkZUNyY0J5dGVWYWx1ZSIsImhlYWRlcnMiLCJoZWFkZXJCeXRlcyIsImhlYWRlclJlYWRlclN0cmVhbSIsImhlYWRlclR5cGVOYW1lIiwicGF5bG9hZFN0cmVhbSIsInBheUxvYWRMZW5ndGgiLCJwYXlMb2FkQnVmZmVyIiwibWVzc2FnZUNyY0J5dGVWYWx1ZSIsImNhbGN1bGF0ZWRDcmMiLCJtZXNzYWdlVHlwZSIsImVycm9yTWVzc2FnZSIsImNvbnRlbnRUeXBlIiwiZXZlbnRUeXBlIiwic2V0UmVzcG9uc2UiLCJyZWFkRGF0YSIsInNldFJlY29yZHMiLCJwcm9ncmVzc0RhdGEiLCJzZXRQcm9ncmVzcyIsInN0YXRzRGF0YSIsInNldFN0YXRzIiwid2FybmluZ01lc3NhZ2UiLCJjb25zb2xlIiwid2FybiJdLCJzb3VyY2VzIjpbInhtbC1wYXJzZXJzLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qXG4gKiBNaW5JTyBKYXZhc2NyaXB0IExpYnJhcnkgZm9yIEFtYXpvbiBTMyBDb21wYXRpYmxlIENsb3VkIFN0b3JhZ2UsIChDKSAyMDE1IE1pbklPLCBJbmMuXG4gKlxuICogTGljZW5zZWQgdW5kZXIgdGhlIEFwYWNoZSBMaWNlbnNlLCBWZXJzaW9uIDIuMCAodGhlIFwiTGljZW5zZVwiKTtcbiAqIHlvdSBtYXkgbm90IHVzZSB0aGlzIGZpbGUgZXhjZXB0IGluIGNvbXBsaWFuY2Ugd2l0aCB0aGUgTGljZW5zZS5cbiAqIFlvdSBtYXkgb2J0YWluIGEgY29weSBvZiB0aGUgTGljZW5zZSBhdFxuICpcbiAqICAgICBodHRwOi8vd3d3LmFwYWNoZS5vcmcvbGljZW5zZXMvTElDRU5TRS0yLjBcbiAqXG4gKiBVbmxlc3MgcmVxdWlyZWQgYnkgYXBwbGljYWJsZSBsYXcgb3IgYWdyZWVkIHRvIGluIHdyaXRpbmcsIHNvZnR3YXJlXG4gKiBkaXN0cmlidXRlZCB1bmRlciB0aGUgTGljZW5zZSBpcyBkaXN0cmlidXRlZCBvbiBhbiBcIkFTIElTXCIgQkFTSVMsXG4gKiBXSVRIT1VUIFdBUlJBTlRJRVMgT1IgQ09ORElUSU9OUyBPRiBBTlkgS0lORCwgZWl0aGVyIGV4cHJlc3Mgb3IgaW1wbGllZC5cbiAqIFNlZSB0aGUgTGljZW5zZSBmb3IgdGhlIHNwZWNpZmljIGxhbmd1YWdlIGdvdmVybmluZyBwZXJtaXNzaW9ucyBhbmRcbiAqIGxpbWl0YXRpb25zIHVuZGVyIHRoZSBMaWNlbnNlLlxuICovXG5cbmltcG9ydCBjcmMzMiBmcm9tICdidWZmZXItY3JjMzInXG5pbXBvcnQgeyBYTUxQYXJzZXIgfSBmcm9tICdmYXN0LXhtbC1wYXJzZXInXG5cbmltcG9ydCAqIGFzIGVycm9ycyBmcm9tICcuL2Vycm9ycy50cydcbmltcG9ydCB7IFNlbGVjdFJlc3VsdHMgfSBmcm9tICcuL2hlbHBlcnMudHMnXG5pbXBvcnQge1xuICBpc09iamVjdCxcbiAgcGFyc2VYbWwsXG4gIHJlYWRhYmxlU3RyZWFtLFxuICBzYW5pdGl6ZUVUYWcsXG4gIHNhbml0aXplT2JqZWN0S2V5LFxuICBzYW5pdGl6ZVNpemUsXG4gIHRvQXJyYXksXG59IGZyb20gJy4vaW50ZXJuYWwvaGVscGVyLnRzJ1xuXG5jb25zdCBmeHBXaXRob3V0TnVtUGFyc2VyID0gbmV3IFhNTFBhcnNlcih7XG4gIG51bWJlclBhcnNlT3B0aW9uczoge1xuICAgIHNraXBMaWtlOiAvLi8sXG4gIH0sXG59KVxuXG4vLyBwYXJzZSBYTUwgcmVzcG9uc2UgZm9yIGNvcHkgb2JqZWN0XG5leHBvcnQgZnVuY3Rpb24gcGFyc2VDb3B5T2JqZWN0KHhtbCkge1xuICB2YXIgcmVzdWx0ID0ge1xuICAgIGV0YWc6ICcnLFxuICAgIGxhc3RNb2RpZmllZDogJycsXG4gIH1cblxuICB2YXIgeG1sb2JqID0gcGFyc2VYbWwoeG1sKVxuICBpZiAoIXhtbG9iai5Db3B5T2JqZWN0UmVzdWx0KSB7XG4gICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkWE1MRXJyb3IoJ01pc3NpbmcgdGFnOiBcIkNvcHlPYmplY3RSZXN1bHRcIicpXG4gIH1cbiAgeG1sb2JqID0geG1sb2JqLkNvcHlPYmplY3RSZXN1bHRcbiAgaWYgKHhtbG9iai5FVGFnKSB7XG4gICAgcmVzdWx0LmV0YWcgPSB4bWxvYmouRVRhZy5yZXBsYWNlKC9eXCIvZywgJycpXG4gICAgICAucmVwbGFjZSgvXCIkL2csICcnKVxuICAgICAgLnJlcGxhY2UoL14mcXVvdDsvZywgJycpXG4gICAgICAucmVwbGFjZSgvJnF1b3Q7JC9nLCAnJylcbiAgICAgIC5yZXBsYWNlKC9eJiMzNDsvZywgJycpXG4gICAgICAucmVwbGFjZSgvJiMzNDskL2csICcnKVxuICB9XG4gIGlmICh4bWxvYmouTGFzdE1vZGlmaWVkKSB7XG4gICAgcmVzdWx0Lmxhc3RNb2RpZmllZCA9IG5ldyBEYXRlKHhtbG9iai5MYXN0TW9kaWZpZWQpXG4gIH1cblxuICByZXR1cm4gcmVzdWx0XG59XG5cbi8vIHBhcnNlIFhNTCByZXNwb25zZSBmb3IgYnVja2V0IG5vdGlmaWNhdGlvblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlQnVja2V0Tm90aWZpY2F0aW9uKHhtbCkge1xuICB2YXIgcmVzdWx0ID0ge1xuICAgIFRvcGljQ29uZmlndXJhdGlvbjogW10sXG4gICAgUXVldWVDb25maWd1cmF0aW9uOiBbXSxcbiAgICBDbG91ZEZ1bmN0aW9uQ29uZmlndXJhdGlvbjogW10sXG4gIH1cbiAgLy8gUGFyc2UgdGhlIGV2ZW50cyBsaXN0XG4gIHZhciBnZW5FdmVudHMgPSBmdW5jdGlvbiAoZXZlbnRzKSB7XG4gICAgdmFyIHJlc3VsdCA9IFtdXG4gICAgaWYgKGV2ZW50cykge1xuICAgICAgdG9BcnJheShldmVudHMpLmZvckVhY2goKHMzZXZlbnQpID0+IHtcbiAgICAgICAgcmVzdWx0LnB1c2goczNldmVudClcbiAgICAgIH0pXG4gICAgfVxuICAgIHJldHVybiByZXN1bHRcbiAgfVxuICAvLyBQYXJzZSBhbGwgZmlsdGVyIHJ1bGVzXG4gIHZhciBnZW5GaWx0ZXJSdWxlcyA9IGZ1bmN0aW9uIChmaWx0ZXJzKSB7XG4gICAgdmFyIHJlc3VsdCA9IFtdXG4gICAgaWYgKGZpbHRlcnMpIHtcbiAgICAgIGZpbHRlcnMgPSB0b0FycmF5KGZpbHRlcnMpXG4gICAgICBpZiAoZmlsdGVyc1swXS5TM0tleSkge1xuICAgICAgICBmaWx0ZXJzWzBdLlMzS2V5ID0gdG9BcnJheShmaWx0ZXJzWzBdLlMzS2V5KVxuICAgICAgICBpZiAoZmlsdGVyc1swXS5TM0tleVswXS5GaWx0ZXJSdWxlKSB7XG4gICAgICAgICAgdG9BcnJheShmaWx0ZXJzWzBdLlMzS2V5WzBdLkZpbHRlclJ1bGUpLmZvckVhY2goKHJ1bGUpID0+IHtcbiAgICAgICAgICAgIHZhciBOYW1lID0gdG9BcnJheShydWxlLk5hbWUpWzBdXG4gICAgICAgICAgICB2YXIgVmFsdWUgPSB0b0FycmF5KHJ1bGUuVmFsdWUpWzBdXG4gICAgICAgICAgICByZXN1bHQucHVzaCh7IE5hbWUsIFZhbHVlIH0pXG4gICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0XG4gIH1cblxuICB2YXIgeG1sb2JqID0gcGFyc2VYbWwoeG1sKVxuICB4bWxvYmogPSB4bWxvYmouTm90aWZpY2F0aW9uQ29uZmlndXJhdGlvblxuXG4gIC8vIFBhcnNlIGFsbCB0b3BpYyBjb25maWd1cmF0aW9ucyBpbiB0aGUgeG1sXG4gIGlmICh4bWxvYmouVG9waWNDb25maWd1cmF0aW9uKSB7XG4gICAgdG9BcnJheSh4bWxvYmouVG9waWNDb25maWd1cmF0aW9uKS5mb3JFYWNoKChjb25maWcpID0+IHtcbiAgICAgIHZhciBJZCA9IHRvQXJyYXkoY29uZmlnLklkKVswXVxuICAgICAgdmFyIFRvcGljID0gdG9BcnJheShjb25maWcuVG9waWMpWzBdXG4gICAgICB2YXIgRXZlbnQgPSBnZW5FdmVudHMoY29uZmlnLkV2ZW50KVxuICAgICAgdmFyIEZpbHRlciA9IGdlbkZpbHRlclJ1bGVzKGNvbmZpZy5GaWx0ZXIpXG4gICAgICByZXN1bHQuVG9waWNDb25maWd1cmF0aW9uLnB1c2goeyBJZCwgVG9waWMsIEV2ZW50LCBGaWx0ZXIgfSlcbiAgICB9KVxuICB9XG4gIC8vIFBhcnNlIGFsbCB0b3BpYyBjb25maWd1cmF0aW9ucyBpbiB0aGUgeG1sXG4gIGlmICh4bWxvYmouUXVldWVDb25maWd1cmF0aW9uKSB7XG4gICAgdG9BcnJheSh4bWxvYmouUXVldWVDb25maWd1cmF0aW9uKS5mb3JFYWNoKChjb25maWcpID0+IHtcbiAgICAgIHZhciBJZCA9IHRvQXJyYXkoY29uZmlnLklkKVswXVxuICAgICAgdmFyIFF1ZXVlID0gdG9BcnJheShjb25maWcuUXVldWUpWzBdXG4gICAgICB2YXIgRXZlbnQgPSBnZW5FdmVudHMoY29uZmlnLkV2ZW50KVxuICAgICAgdmFyIEZpbHRlciA9IGdlbkZpbHRlclJ1bGVzKGNvbmZpZy5GaWx0ZXIpXG4gICAgICByZXN1bHQuUXVldWVDb25maWd1cmF0aW9uLnB1c2goeyBJZCwgUXVldWUsIEV2ZW50LCBGaWx0ZXIgfSlcbiAgICB9KVxuICB9XG4gIC8vIFBhcnNlIGFsbCBRdWV1ZUNvbmZpZ3VyYXRpb24gYXJyYXlzXG4gIGlmICh4bWxvYmouQ2xvdWRGdW5jdGlvbkNvbmZpZ3VyYXRpb24pIHtcbiAgICB0b0FycmF5KHhtbG9iai5DbG91ZEZ1bmN0aW9uQ29uZmlndXJhdGlvbikuZm9yRWFjaCgoY29uZmlnKSA9PiB7XG4gICAgICB2YXIgSWQgPSB0b0FycmF5KGNvbmZpZy5JZClbMF1cbiAgICAgIHZhciBDbG91ZEZ1bmN0aW9uID0gdG9BcnJheShjb25maWcuQ2xvdWRGdW5jdGlvbilbMF1cbiAgICAgIHZhciBFdmVudCA9IGdlbkV2ZW50cyhjb25maWcuRXZlbnQpXG4gICAgICB2YXIgRmlsdGVyID0gZ2VuRmlsdGVyUnVsZXMoY29uZmlnLkZpbHRlcilcbiAgICAgIHJlc3VsdC5DbG91ZEZ1bmN0aW9uQ29uZmlndXJhdGlvbi5wdXNoKHsgSWQsIENsb3VkRnVuY3Rpb24sIEV2ZW50LCBGaWx0ZXIgfSlcbiAgICB9KVxuICB9XG5cbiAgcmV0dXJuIHJlc3VsdFxufVxuXG5jb25zdCBmb3JtYXRPYmpJbmZvID0gKGNvbnRlbnQsIG9wdHMgPSB7fSkgPT4ge1xuICBsZXQgeyBLZXksIExhc3RNb2RpZmllZCwgRVRhZywgU2l6ZSwgVmVyc2lvbklkLCBJc0xhdGVzdCB9ID0gY29udGVudFxuXG4gIGlmICghaXNPYmplY3Qob3B0cykpIHtcbiAgICBvcHRzID0ge31cbiAgfVxuXG4gIGNvbnN0IG5hbWUgPSBzYW5pdGl6ZU9iamVjdEtleSh0b0FycmF5KEtleSlbMF0pXG4gIGNvbnN0IGxhc3RNb2RpZmllZCA9IG5ldyBEYXRlKHRvQXJyYXkoTGFzdE1vZGlmaWVkKVswXSlcbiAgY29uc3QgZXRhZyA9IHNhbml0aXplRVRhZyh0b0FycmF5KEVUYWcpWzBdKVxuICBjb25zdCBzaXplID0gc2FuaXRpemVTaXplKFNpemUpXG5cbiAgcmV0dXJuIHtcbiAgICBuYW1lLFxuICAgIGxhc3RNb2RpZmllZCxcbiAgICBldGFnLFxuICAgIHNpemUsXG4gICAgdmVyc2lvbklkOiBWZXJzaW9uSWQsXG4gICAgaXNMYXRlc3Q6IElzTGF0ZXN0LFxuICAgIGlzRGVsZXRlTWFya2VyOiBvcHRzLklzRGVsZXRlTWFya2VyID8gb3B0cy5Jc0RlbGV0ZU1hcmtlciA6IGZhbHNlLFxuICB9XG59XG5cbi8vIHBhcnNlIFhNTCByZXNwb25zZSBmb3IgbGlzdCBvYmplY3RzIGluIGEgYnVja2V0XG5leHBvcnQgZnVuY3Rpb24gcGFyc2VMaXN0T2JqZWN0cyh4bWwpIHtcbiAgdmFyIHJlc3VsdCA9IHtcbiAgICBvYmplY3RzOiBbXSxcbiAgICBpc1RydW5jYXRlZDogZmFsc2UsXG4gIH1cbiAgbGV0IGlzVHJ1bmNhdGVkID0gZmFsc2VcbiAgbGV0IG5leHRNYXJrZXIsIG5leHRWZXJzaW9uS2V5TWFya2VyXG4gIGNvbnN0IHhtbG9iaiA9IGZ4cFdpdGhvdXROdW1QYXJzZXIucGFyc2UoeG1sKVxuXG4gIGNvbnN0IHBhcnNlQ29tbW9uUHJlZml4ZXNFbnRpdHkgPSAocmVzcG9uc2VFbnRpdHkpID0+IHtcbiAgICBpZiAocmVzcG9uc2VFbnRpdHkpIHtcbiAgICAgIHRvQXJyYXkocmVzcG9uc2VFbnRpdHkpLmZvckVhY2goKGNvbW1vblByZWZpeCkgPT4ge1xuICAgICAgICByZXN1bHQub2JqZWN0cy5wdXNoKHsgcHJlZml4OiBzYW5pdGl6ZU9iamVjdEtleSh0b0FycmF5KGNvbW1vblByZWZpeC5QcmVmaXgpWzBdKSwgc2l6ZTogMCB9KVxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICBjb25zdCBsaXN0QnVja2V0UmVzdWx0ID0geG1sb2JqLkxpc3RCdWNrZXRSZXN1bHRcbiAgY29uc3QgbGlzdFZlcnNpb25zUmVzdWx0ID0geG1sb2JqLkxpc3RWZXJzaW9uc1Jlc3VsdFxuXG4gIGlmIChsaXN0QnVja2V0UmVzdWx0KSB7XG4gICAgaWYgKGxpc3RCdWNrZXRSZXN1bHQuSXNUcnVuY2F0ZWQpIHtcbiAgICAgIGlzVHJ1bmNhdGVkID0gbGlzdEJ1Y2tldFJlc3VsdC5Jc1RydW5jYXRlZFxuICAgIH1cbiAgICBpZiAobGlzdEJ1Y2tldFJlc3VsdC5Db250ZW50cykge1xuICAgICAgdG9BcnJheShsaXN0QnVja2V0UmVzdWx0LkNvbnRlbnRzKS5mb3JFYWNoKChjb250ZW50KSA9PiB7XG4gICAgICAgIGNvbnN0IG5hbWUgPSBzYW5pdGl6ZU9iamVjdEtleSh0b0FycmF5KGNvbnRlbnQuS2V5KVswXSlcbiAgICAgICAgY29uc3QgbGFzdE1vZGlmaWVkID0gbmV3IERhdGUodG9BcnJheShjb250ZW50Lkxhc3RNb2RpZmllZClbMF0pXG4gICAgICAgIGNvbnN0IGV0YWcgPSBzYW5pdGl6ZUVUYWcodG9BcnJheShjb250ZW50LkVUYWcpWzBdKVxuICAgICAgICBjb25zdCBzaXplID0gc2FuaXRpemVTaXplKGNvbnRlbnQuU2l6ZSlcbiAgICAgICAgcmVzdWx0Lm9iamVjdHMucHVzaCh7IG5hbWUsIGxhc3RNb2RpZmllZCwgZXRhZywgc2l6ZSB9KVxuICAgICAgfSlcbiAgICB9XG5cbiAgICBpZiAobGlzdEJ1Y2tldFJlc3VsdC5OZXh0TWFya2VyKSB7XG4gICAgICBuZXh0TWFya2VyID0gbGlzdEJ1Y2tldFJlc3VsdC5OZXh0TWFya2VyXG4gICAgfVxuICAgIHBhcnNlQ29tbW9uUHJlZml4ZXNFbnRpdHkobGlzdEJ1Y2tldFJlc3VsdC5Db21tb25QcmVmaXhlcylcbiAgfVxuXG4gIGlmIChsaXN0VmVyc2lvbnNSZXN1bHQpIHtcbiAgICBpZiAobGlzdFZlcnNpb25zUmVzdWx0LklzVHJ1bmNhdGVkKSB7XG4gICAgICBpc1RydW5jYXRlZCA9IGxpc3RWZXJzaW9uc1Jlc3VsdC5Jc1RydW5jYXRlZFxuICAgIH1cblxuICAgIGlmIChsaXN0VmVyc2lvbnNSZXN1bHQuVmVyc2lvbikge1xuICAgICAgdG9BcnJheShsaXN0VmVyc2lvbnNSZXN1bHQuVmVyc2lvbikuZm9yRWFjaCgoY29udGVudCkgPT4ge1xuICAgICAgICByZXN1bHQub2JqZWN0cy5wdXNoKGZvcm1hdE9iakluZm8oY29udGVudCkpXG4gICAgICB9KVxuICAgIH1cbiAgICBpZiAobGlzdFZlcnNpb25zUmVzdWx0LkRlbGV0ZU1hcmtlcikge1xuICAgICAgdG9BcnJheShsaXN0VmVyc2lvbnNSZXN1bHQuRGVsZXRlTWFya2VyKS5mb3JFYWNoKChjb250ZW50KSA9PiB7XG4gICAgICAgIHJlc3VsdC5vYmplY3RzLnB1c2goZm9ybWF0T2JqSW5mbyhjb250ZW50LCB7IElzRGVsZXRlTWFya2VyOiB0cnVlIH0pKVxuICAgICAgfSlcbiAgICB9XG5cbiAgICBpZiAobGlzdFZlcnNpb25zUmVzdWx0Lk5leHRLZXlNYXJrZXIpIHtcbiAgICAgIG5leHRWZXJzaW9uS2V5TWFya2VyID0gbGlzdFZlcnNpb25zUmVzdWx0Lk5leHRLZXlNYXJrZXJcbiAgICB9XG4gICAgaWYgKGxpc3RWZXJzaW9uc1Jlc3VsdC5OZXh0VmVyc2lvbklkTWFya2VyKSB7XG4gICAgICByZXN1bHQudmVyc2lvbklkTWFya2VyID0gbGlzdFZlcnNpb25zUmVzdWx0Lk5leHRWZXJzaW9uSWRNYXJrZXJcbiAgICB9XG4gICAgcGFyc2VDb21tb25QcmVmaXhlc0VudGl0eShsaXN0VmVyc2lvbnNSZXN1bHQuQ29tbW9uUHJlZml4ZXMpXG4gIH1cblxuICByZXN1bHQuaXNUcnVuY2F0ZWQgPSBpc1RydW5jYXRlZFxuICBpZiAoaXNUcnVuY2F0ZWQpIHtcbiAgICByZXN1bHQubmV4dE1hcmtlciA9IG5leHRWZXJzaW9uS2V5TWFya2VyIHx8IG5leHRNYXJrZXJcbiAgfVxuICByZXR1cm4gcmVzdWx0XG59XG5cbi8vIHBhcnNlIFhNTCByZXNwb25zZSBmb3IgbGlzdCBvYmplY3RzIHYyIGluIGEgYnVja2V0XG5leHBvcnQgZnVuY3Rpb24gcGFyc2VMaXN0T2JqZWN0c1YyKHhtbCkge1xuICB2YXIgcmVzdWx0ID0ge1xuICAgIG9iamVjdHM6IFtdLFxuICAgIGlzVHJ1bmNhdGVkOiBmYWxzZSxcbiAgfVxuICB2YXIgeG1sb2JqID0gcGFyc2VYbWwoeG1sKVxuICBpZiAoIXhtbG9iai5MaXN0QnVja2V0UmVzdWx0KSB7XG4gICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkWE1MRXJyb3IoJ01pc3NpbmcgdGFnOiBcIkxpc3RCdWNrZXRSZXN1bHRcIicpXG4gIH1cbiAgeG1sb2JqID0geG1sb2JqLkxpc3RCdWNrZXRSZXN1bHRcbiAgaWYgKHhtbG9iai5Jc1RydW5jYXRlZCkge1xuICAgIHJlc3VsdC5pc1RydW5jYXRlZCA9IHhtbG9iai5Jc1RydW5jYXRlZFxuICB9XG4gIGlmICh4bWxvYmouTmV4dENvbnRpbnVhdGlvblRva2VuKSB7XG4gICAgcmVzdWx0Lm5leHRDb250aW51YXRpb25Ub2tlbiA9IHhtbG9iai5OZXh0Q29udGludWF0aW9uVG9rZW5cbiAgfVxuICBpZiAoeG1sb2JqLkNvbnRlbnRzKSB7XG4gICAgdG9BcnJheSh4bWxvYmouQ29udGVudHMpLmZvckVhY2goKGNvbnRlbnQpID0+IHtcbiAgICAgIHZhciBuYW1lID0gc2FuaXRpemVPYmplY3RLZXkodG9BcnJheShjb250ZW50LktleSlbMF0pXG4gICAgICB2YXIgbGFzdE1vZGlmaWVkID0gbmV3IERhdGUoY29udGVudC5MYXN0TW9kaWZpZWQpXG4gICAgICB2YXIgZXRhZyA9IHNhbml0aXplRVRhZyhjb250ZW50LkVUYWcpXG4gICAgICB2YXIgc2l6ZSA9IGNvbnRlbnQuU2l6ZVxuICAgICAgcmVzdWx0Lm9iamVjdHMucHVzaCh7IG5hbWUsIGxhc3RNb2RpZmllZCwgZXRhZywgc2l6ZSB9KVxuICAgIH0pXG4gIH1cbiAgaWYgKHhtbG9iai5Db21tb25QcmVmaXhlcykge1xuICAgIHRvQXJyYXkoeG1sb2JqLkNvbW1vblByZWZpeGVzKS5mb3JFYWNoKChjb21tb25QcmVmaXgpID0+IHtcbiAgICAgIHJlc3VsdC5vYmplY3RzLnB1c2goeyBwcmVmaXg6IHNhbml0aXplT2JqZWN0S2V5KHRvQXJyYXkoY29tbW9uUHJlZml4LlByZWZpeClbMF0pLCBzaXplOiAwIH0pXG4gICAgfSlcbiAgfVxuICByZXR1cm4gcmVzdWx0XG59XG5cbi8vIHBhcnNlIFhNTCByZXNwb25zZSBmb3IgbGlzdCBvYmplY3RzIHYyIHdpdGggbWV0YWRhdGEgaW4gYSBidWNrZXRcbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUxpc3RPYmplY3RzVjJXaXRoTWV0YWRhdGEoeG1sKSB7XG4gIHZhciByZXN1bHQgPSB7XG4gICAgb2JqZWN0czogW10sXG4gICAgaXNUcnVuY2F0ZWQ6IGZhbHNlLFxuICB9XG4gIHZhciB4bWxvYmogPSBwYXJzZVhtbCh4bWwpXG4gIGlmICgheG1sb2JqLkxpc3RCdWNrZXRSZXN1bHQpIHtcbiAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRYTUxFcnJvcignTWlzc2luZyB0YWc6IFwiTGlzdEJ1Y2tldFJlc3VsdFwiJylcbiAgfVxuICB4bWxvYmogPSB4bWxvYmouTGlzdEJ1Y2tldFJlc3VsdFxuICBpZiAoeG1sb2JqLklzVHJ1bmNhdGVkKSB7XG4gICAgcmVzdWx0LmlzVHJ1bmNhdGVkID0geG1sb2JqLklzVHJ1bmNhdGVkXG4gIH1cbiAgaWYgKHhtbG9iai5OZXh0Q29udGludWF0aW9uVG9rZW4pIHtcbiAgICByZXN1bHQubmV4dENvbnRpbnVhdGlvblRva2VuID0geG1sb2JqLk5leHRDb250aW51YXRpb25Ub2tlblxuICB9XG5cbiAgaWYgKHhtbG9iai5Db250ZW50cykge1xuICAgIHRvQXJyYXkoeG1sb2JqLkNvbnRlbnRzKS5mb3JFYWNoKChjb250ZW50KSA9PiB7XG4gICAgICB2YXIgbmFtZSA9IHNhbml0aXplT2JqZWN0S2V5KGNvbnRlbnQuS2V5KVxuICAgICAgdmFyIGxhc3RNb2RpZmllZCA9IG5ldyBEYXRlKGNvbnRlbnQuTGFzdE1vZGlmaWVkKVxuICAgICAgdmFyIGV0YWcgPSBzYW5pdGl6ZUVUYWcoY29udGVudC5FVGFnKVxuICAgICAgdmFyIHNpemUgPSBjb250ZW50LlNpemVcbiAgICAgIHZhciBtZXRhZGF0YVxuICAgICAgaWYgKGNvbnRlbnQuVXNlck1ldGFkYXRhICE9IG51bGwpIHtcbiAgICAgICAgbWV0YWRhdGEgPSB0b0FycmF5KGNvbnRlbnQuVXNlck1ldGFkYXRhKVswXVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbWV0YWRhdGEgPSBudWxsXG4gICAgICB9XG4gICAgICByZXN1bHQub2JqZWN0cy5wdXNoKHsgbmFtZSwgbGFzdE1vZGlmaWVkLCBldGFnLCBzaXplLCBtZXRhZGF0YSB9KVxuICAgIH0pXG4gIH1cblxuICBpZiAoeG1sb2JqLkNvbW1vblByZWZpeGVzKSB7XG4gICAgdG9BcnJheSh4bWxvYmouQ29tbW9uUHJlZml4ZXMpLmZvckVhY2goKGNvbW1vblByZWZpeCkgPT4ge1xuICAgICAgcmVzdWx0Lm9iamVjdHMucHVzaCh7IHByZWZpeDogc2FuaXRpemVPYmplY3RLZXkodG9BcnJheShjb21tb25QcmVmaXguUHJlZml4KVswXSksIHNpemU6IDAgfSlcbiAgICB9KVxuICB9XG4gIHJldHVybiByZXN1bHRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlTGlmZWN5Y2xlQ29uZmlnKHhtbCkge1xuICBjb25zdCB4bWxPYmogPSBwYXJzZVhtbCh4bWwpXG4gIHJldHVybiB4bWxPYmouTGlmZWN5Y2xlQ29uZmlndXJhdGlvblxufVxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlT2JqZWN0UmV0ZW50aW9uQ29uZmlnKHhtbCkge1xuICBjb25zdCB4bWxPYmogPSBwYXJzZVhtbCh4bWwpXG4gIGNvbnN0IHJldGVudGlvbkNvbmZpZyA9IHhtbE9iai5SZXRlbnRpb25cblxuICByZXR1cm4ge1xuICAgIG1vZGU6IHJldGVudGlvbkNvbmZpZy5Nb2RlLFxuICAgIHJldGFpblVudGlsRGF0ZTogcmV0ZW50aW9uQ29uZmlnLlJldGFpblVudGlsRGF0ZSxcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VCdWNrZXRFbmNyeXB0aW9uQ29uZmlnKHhtbCkge1xuICBsZXQgZW5jQ29uZmlnID0gcGFyc2VYbWwoeG1sKVxuICByZXR1cm4gZW5jQ29uZmlnXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZU9iamVjdExlZ2FsSG9sZENvbmZpZyh4bWwpIHtcbiAgY29uc3QgeG1sT2JqID0gcGFyc2VYbWwoeG1sKVxuICByZXR1cm4geG1sT2JqLkxlZ2FsSG9sZFxufVxuXG5leHBvcnQgZnVuY3Rpb24gdXBsb2FkUGFydFBhcnNlcih4bWwpIHtcbiAgY29uc3QgeG1sT2JqID0gcGFyc2VYbWwoeG1sKVxuICBjb25zdCByZXNwRWwgPSB4bWxPYmouQ29weVBhcnRSZXN1bHRcbiAgcmV0dXJuIHJlc3BFbFxufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVtb3ZlT2JqZWN0c1BhcnNlcih4bWwpIHtcbiAgY29uc3QgeG1sT2JqID0gcGFyc2VYbWwoeG1sKVxuICBpZiAoeG1sT2JqLkRlbGV0ZVJlc3VsdCAmJiB4bWxPYmouRGVsZXRlUmVzdWx0LkVycm9yKSB7XG4gICAgLy8gcmV0dXJuIGVycm9ycyBhcyBhcnJheSBhbHdheXMuIGFzIHRoZSByZXNwb25zZSBpcyBvYmplY3QgaW4gY2FzZSBvZiBzaW5nbGUgb2JqZWN0IHBhc3NlZCBpbiByZW1vdmVPYmplY3RzXG4gICAgcmV0dXJuIHRvQXJyYXkoeG1sT2JqLkRlbGV0ZVJlc3VsdC5FcnJvcilcbiAgfVxuICByZXR1cm4gW11cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlU2VsZWN0T2JqZWN0Q29udGVudFJlc3BvbnNlKHJlcykge1xuICAvLyBleHRyYWN0SGVhZGVyVHlwZSBleHRyYWN0cyB0aGUgZmlyc3QgaGFsZiBvZiB0aGUgaGVhZGVyIG1lc3NhZ2UsIHRoZSBoZWFkZXIgdHlwZS5cbiAgZnVuY3Rpb24gZXh0cmFjdEhlYWRlclR5cGUoc3RyZWFtKSB7XG4gICAgY29uc3QgaGVhZGVyTmFtZUxlbiA9IEJ1ZmZlci5mcm9tKHN0cmVhbS5yZWFkKDEpKS5yZWFkVUludDgoKVxuICAgIGNvbnN0IGhlYWRlck5hbWVXaXRoU2VwYXJhdG9yID0gQnVmZmVyLmZyb20oc3RyZWFtLnJlYWQoaGVhZGVyTmFtZUxlbikpLnRvU3RyaW5nKClcbiAgICBjb25zdCBzcGxpdEJ5U2VwYXJhdG9yID0gKGhlYWRlck5hbWVXaXRoU2VwYXJhdG9yIHx8ICcnKS5zcGxpdCgnOicpXG4gICAgY29uc3QgaGVhZGVyTmFtZSA9IHNwbGl0QnlTZXBhcmF0b3IubGVuZ3RoID49IDEgPyBzcGxpdEJ5U2VwYXJhdG9yWzFdIDogJydcbiAgICByZXR1cm4gaGVhZGVyTmFtZVxuICB9XG5cbiAgZnVuY3Rpb24gZXh0cmFjdEhlYWRlclZhbHVlKHN0cmVhbSkge1xuICAgIGNvbnN0IGJvZHlMZW4gPSBCdWZmZXIuZnJvbShzdHJlYW0ucmVhZCgyKSkucmVhZFVJbnQxNkJFKClcbiAgICBjb25zdCBib2R5TmFtZSA9IEJ1ZmZlci5mcm9tKHN0cmVhbS5yZWFkKGJvZHlMZW4pKS50b1N0cmluZygpXG4gICAgcmV0dXJuIGJvZHlOYW1lXG4gIH1cblxuICBjb25zdCBzZWxlY3RSZXN1bHRzID0gbmV3IFNlbGVjdFJlc3VsdHMoe30pIC8vIHdpbGwgYmUgcmV0dXJuZWRcblxuICBjb25zdCByZXNwb25zZVN0cmVhbSA9IHJlYWRhYmxlU3RyZWFtKHJlcykgLy8gY29udmVydCBieXRlIGFycmF5IHRvIGEgcmVhZGFibGUgcmVzcG9uc2VTdHJlYW1cbiAgd2hpbGUgKHJlc3BvbnNlU3RyZWFtLl9yZWFkYWJsZVN0YXRlLmxlbmd0aCkge1xuICAgIC8vIFRvcCBsZXZlbCByZXNwb25zZVN0cmVhbSByZWFkIHRyYWNrZXIuXG4gICAgbGV0IG1zZ0NyY0FjY3VtdWxhdG9yIC8vIGFjY3VtdWxhdGUgZnJvbSBzdGFydCBvZiB0aGUgbWVzc2FnZSB0aWxsIHRoZSBtZXNzYWdlIGNyYyBzdGFydC5cblxuICAgIGNvbnN0IHRvdGFsQnl0ZUxlbmd0aEJ1ZmZlciA9IEJ1ZmZlci5mcm9tKHJlc3BvbnNlU3RyZWFtLnJlYWQoNCkpXG4gICAgbXNnQ3JjQWNjdW11bGF0b3IgPSBjcmMzMih0b3RhbEJ5dGVMZW5ndGhCdWZmZXIpXG5cbiAgICBjb25zdCBoZWFkZXJCeXRlc0J1ZmZlciA9IEJ1ZmZlci5mcm9tKHJlc3BvbnNlU3RyZWFtLnJlYWQoNCkpXG4gICAgbXNnQ3JjQWNjdW11bGF0b3IgPSBjcmMzMihoZWFkZXJCeXRlc0J1ZmZlciwgbXNnQ3JjQWNjdW11bGF0b3IpXG5cbiAgICBjb25zdCBjYWxjdWxhdGVkUHJlbHVkZUNyYyA9IG1zZ0NyY0FjY3VtdWxhdG9yLnJlYWRJbnQzMkJFKCkgLy8gdXNlIGl0IHRvIGNoZWNrIGlmIGFueSBDUkMgbWlzbWF0Y2ggaW4gaGVhZGVyIGl0c2VsZi5cblxuICAgIGNvbnN0IHByZWx1ZGVDcmNCdWZmZXIgPSBCdWZmZXIuZnJvbShyZXNwb25zZVN0cmVhbS5yZWFkKDQpKSAvLyByZWFkIDQgYnl0ZXMgICAgaS5lIDQrNCA9OCArIDQgPSAxMiAoIHByZWx1ZGUgKyBwcmVsdWRlIGNyYylcbiAgICBtc2dDcmNBY2N1bXVsYXRvciA9IGNyYzMyKHByZWx1ZGVDcmNCdWZmZXIsIG1zZ0NyY0FjY3VtdWxhdG9yKVxuXG4gICAgY29uc3QgdG90YWxNc2dMZW5ndGggPSB0b3RhbEJ5dGVMZW5ndGhCdWZmZXIucmVhZEludDMyQkUoKVxuICAgIGNvbnN0IGhlYWRlckxlbmd0aCA9IGhlYWRlckJ5dGVzQnVmZmVyLnJlYWRJbnQzMkJFKClcbiAgICBjb25zdCBwcmVsdWRlQ3JjQnl0ZVZhbHVlID0gcHJlbHVkZUNyY0J1ZmZlci5yZWFkSW50MzJCRSgpXG5cbiAgICBpZiAocHJlbHVkZUNyY0J5dGVWYWx1ZSAhPT0gY2FsY3VsYXRlZFByZWx1ZGVDcmMpIHtcbiAgICAgIC8vIEhhbmRsZSBIZWFkZXIgQ1JDIG1pc21hdGNoIEVycm9yXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIGBIZWFkZXIgQ2hlY2tzdW0gTWlzbWF0Y2gsIFByZWx1ZGUgQ1JDIG9mICR7cHJlbHVkZUNyY0J5dGVWYWx1ZX0gZG9lcyBub3QgZXF1YWwgZXhwZWN0ZWQgQ1JDIG9mICR7Y2FsY3VsYXRlZFByZWx1ZGVDcmN9YCxcbiAgICAgIClcbiAgICB9XG5cbiAgICBjb25zdCBoZWFkZXJzID0ge31cbiAgICBpZiAoaGVhZGVyTGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgaGVhZGVyQnl0ZXMgPSBCdWZmZXIuZnJvbShyZXNwb25zZVN0cmVhbS5yZWFkKGhlYWRlckxlbmd0aCkpXG4gICAgICBtc2dDcmNBY2N1bXVsYXRvciA9IGNyYzMyKGhlYWRlckJ5dGVzLCBtc2dDcmNBY2N1bXVsYXRvcilcbiAgICAgIGNvbnN0IGhlYWRlclJlYWRlclN0cmVhbSA9IHJlYWRhYmxlU3RyZWFtKGhlYWRlckJ5dGVzKVxuICAgICAgd2hpbGUgKGhlYWRlclJlYWRlclN0cmVhbS5fcmVhZGFibGVTdGF0ZS5sZW5ndGgpIHtcbiAgICAgICAgbGV0IGhlYWRlclR5cGVOYW1lID0gZXh0cmFjdEhlYWRlclR5cGUoaGVhZGVyUmVhZGVyU3RyZWFtKVxuICAgICAgICBoZWFkZXJSZWFkZXJTdHJlYW0ucmVhZCgxKSAvLyBqdXN0IHJlYWQgYW5kIGlnbm9yZSBpdC5cbiAgICAgICAgaGVhZGVyc1toZWFkZXJUeXBlTmFtZV0gPSBleHRyYWN0SGVhZGVyVmFsdWUoaGVhZGVyUmVhZGVyU3RyZWFtKVxuICAgICAgfVxuICAgIH1cblxuICAgIGxldCBwYXlsb2FkU3RyZWFtXG4gICAgY29uc3QgcGF5TG9hZExlbmd0aCA9IHRvdGFsTXNnTGVuZ3RoIC0gaGVhZGVyTGVuZ3RoIC0gMTZcbiAgICBpZiAocGF5TG9hZExlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IHBheUxvYWRCdWZmZXIgPSBCdWZmZXIuZnJvbShyZXNwb25zZVN0cmVhbS5yZWFkKHBheUxvYWRMZW5ndGgpKVxuICAgICAgbXNnQ3JjQWNjdW11bGF0b3IgPSBjcmMzMihwYXlMb2FkQnVmZmVyLCBtc2dDcmNBY2N1bXVsYXRvcilcbiAgICAgIC8vIHJlYWQgdGhlIGNoZWNrc3VtIGVhcmx5IGFuZCBkZXRlY3QgYW55IG1pc21hdGNoIHNvIHdlIGNhbiBhdm9pZCB1bm5lY2Vzc2FyeSBmdXJ0aGVyIHByb2Nlc3NpbmcuXG4gICAgICBjb25zdCBtZXNzYWdlQ3JjQnl0ZVZhbHVlID0gQnVmZmVyLmZyb20ocmVzcG9uc2VTdHJlYW0ucmVhZCg0KSkucmVhZEludDMyQkUoKVxuICAgICAgY29uc3QgY2FsY3VsYXRlZENyYyA9IG1zZ0NyY0FjY3VtdWxhdG9yLnJlYWRJbnQzMkJFKClcbiAgICAgIC8vIEhhbmRsZSBtZXNzYWdlIENSQyBFcnJvclxuICAgICAgaWYgKG1lc3NhZ2VDcmNCeXRlVmFsdWUgIT09IGNhbGN1bGF0ZWRDcmMpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgIGBNZXNzYWdlIENoZWNrc3VtIE1pc21hdGNoLCBNZXNzYWdlIENSQyBvZiAke21lc3NhZ2VDcmNCeXRlVmFsdWV9IGRvZXMgbm90IGVxdWFsIGV4cGVjdGVkIENSQyBvZiAke2NhbGN1bGF0ZWRDcmN9YCxcbiAgICAgICAgKVxuICAgICAgfVxuICAgICAgcGF5bG9hZFN0cmVhbSA9IHJlYWRhYmxlU3RyZWFtKHBheUxvYWRCdWZmZXIpXG4gICAgfVxuXG4gICAgY29uc3QgbWVzc2FnZVR5cGUgPSBoZWFkZXJzWydtZXNzYWdlLXR5cGUnXVxuXG4gICAgc3dpdGNoIChtZXNzYWdlVHlwZSkge1xuICAgICAgY2FzZSAnZXJyb3InOiB7XG4gICAgICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGhlYWRlcnNbJ2Vycm9yLWNvZGUnXSArICc6XCInICsgaGVhZGVyc1snZXJyb3ItbWVzc2FnZSddICsgJ1wiJ1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoZXJyb3JNZXNzYWdlKVxuICAgICAgfVxuICAgICAgY2FzZSAnZXZlbnQnOiB7XG4gICAgICAgIGNvbnN0IGNvbnRlbnRUeXBlID0gaGVhZGVyc1snY29udGVudC10eXBlJ11cbiAgICAgICAgY29uc3QgZXZlbnRUeXBlID0gaGVhZGVyc1snZXZlbnQtdHlwZSddXG5cbiAgICAgICAgc3dpdGNoIChldmVudFR5cGUpIHtcbiAgICAgICAgICBjYXNlICdFbmQnOiB7XG4gICAgICAgICAgICBzZWxlY3RSZXN1bHRzLnNldFJlc3BvbnNlKHJlcylcbiAgICAgICAgICAgIHJldHVybiBzZWxlY3RSZXN1bHRzXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY2FzZSAnUmVjb3Jkcyc6IHtcbiAgICAgICAgICAgIGNvbnN0IHJlYWREYXRhID0gcGF5bG9hZFN0cmVhbS5yZWFkKHBheUxvYWRMZW5ndGgpXG4gICAgICAgICAgICBzZWxlY3RSZXN1bHRzLnNldFJlY29yZHMocmVhZERhdGEpXG4gICAgICAgICAgICBicmVha1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGNhc2UgJ1Byb2dyZXNzJzpcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgc3dpdGNoIChjb250ZW50VHlwZSkge1xuICAgICAgICAgICAgICAgIGNhc2UgJ3RleHQveG1sJzoge1xuICAgICAgICAgICAgICAgICAgY29uc3QgcHJvZ3Jlc3NEYXRhID0gcGF5bG9hZFN0cmVhbS5yZWFkKHBheUxvYWRMZW5ndGgpXG4gICAgICAgICAgICAgICAgICBzZWxlY3RSZXN1bHRzLnNldFByb2dyZXNzKHByb2dyZXNzRGF0YS50b1N0cmluZygpKVxuICAgICAgICAgICAgICAgICAgYnJlYWtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZGVmYXVsdDoge1xuICAgICAgICAgICAgICAgICAgY29uc3QgZXJyb3JNZXNzYWdlID0gYFVuZXhwZWN0ZWQgY29udGVudC10eXBlICR7Y29udGVudFR5cGV9IHNlbnQgZm9yIGV2ZW50LXR5cGUgUHJvZ3Jlc3NgXG4gICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoZXJyb3JNZXNzYWdlKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgYnJlYWtcbiAgICAgICAgICBjYXNlICdTdGF0cyc6XG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIHN3aXRjaCAoY29udGVudFR5cGUpIHtcbiAgICAgICAgICAgICAgICBjYXNlICd0ZXh0L3htbCc6IHtcbiAgICAgICAgICAgICAgICAgIGNvbnN0IHN0YXRzRGF0YSA9IHBheWxvYWRTdHJlYW0ucmVhZChwYXlMb2FkTGVuZ3RoKVxuICAgICAgICAgICAgICAgICAgc2VsZWN0UmVzdWx0cy5zZXRTdGF0cyhzdGF0c0RhdGEudG9TdHJpbmcoKSlcbiAgICAgICAgICAgICAgICAgIGJyZWFrXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGRlZmF1bHQ6IHtcbiAgICAgICAgICAgICAgICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGBVbmV4cGVjdGVkIGNvbnRlbnQtdHlwZSAke2NvbnRlbnRUeXBlfSBzZW50IGZvciBldmVudC10eXBlIFN0YXRzYFxuICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGVycm9yTWVzc2FnZSlcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGJyZWFrXG4gICAgICAgICAgZGVmYXVsdDoge1xuICAgICAgICAgICAgLy8gQ29udGludWF0aW9uIG1lc3NhZ2U6IE5vdCBzdXJlIGlmIGl0IGlzIHN1cHBvcnRlZC4gZGlkIG5vdCBmaW5kIGEgcmVmZXJlbmNlIG9yIGFueSBtZXNzYWdlIGluIHJlc3BvbnNlLlxuICAgICAgICAgICAgLy8gSXQgZG9lcyBub3QgaGF2ZSBhIHBheWxvYWQuXG4gICAgICAgICAgICBjb25zdCB3YXJuaW5nTWVzc2FnZSA9IGBVbiBpbXBsZW1lbnRlZCBldmVudCBkZXRlY3RlZCAgJHttZXNzYWdlVHlwZX0uYFxuICAgICAgICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgICAgICAgICAgIGNvbnNvbGUud2Fybih3YXJuaW5nTWVzc2FnZSlcbiAgICAgICAgICB9XG4gICAgICAgIH0gLy8gZXZlbnRUeXBlIEVuZFxuICAgICAgfSAvLyBFdmVudCBFbmRcbiAgICB9IC8vIG1lc3NhZ2VUeXBlIEVuZFxuICB9IC8vIFRvcCBMZXZlbCBTdHJlYW0gRW5kXG59XG4iXSwibWFwcGluZ3MiOiJBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7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