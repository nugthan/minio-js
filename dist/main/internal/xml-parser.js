"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.parseBucketRegion = parseBucketRegion;
exports.parseBucketVersioningConfig = parseBucketVersioningConfig;
exports.parseCompleteMultipart = parseCompleteMultipart;
exports.parseError = parseError;
exports.parseInitiateMultipart = parseInitiateMultipart;
exports.parseListBucket = parseListBucket;
exports.parseListMultipart = parseListMultipart;
exports.parseListObjectsV2WithMetadata = parseListObjectsV2WithMetadata;
exports.parseListParts = parseListParts;
exports.parseObjectLegalHoldConfig = parseObjectLegalHoldConfig;
exports.parseObjectLockConfig = parseObjectLockConfig;
exports.parseReplicationConfig = parseReplicationConfig;
exports.parseResponseError = parseResponseError;
exports.parseTagging = parseTagging;
var _fastXmlParser = require("fast-xml-parser");
var errors = _interopRequireWildcard(require("../errors.js"), true);
var _helper = require("./helper.js");
var _response = require("./response.js");
var _type = require("./type.js");
function _getRequireWildcardCache(nodeInterop) { if (typeof WeakMap !== "function") return null; var cacheBabelInterop = new WeakMap(); var cacheNodeInterop = new WeakMap(); return (_getRequireWildcardCache = function (nodeInterop) { return nodeInterop ? cacheNodeInterop : cacheBabelInterop; })(nodeInterop); }
function _interopRequireWildcard(obj, nodeInterop) { if (!nodeInterop && obj && obj.__esModule) { return obj; } if (obj === null || typeof obj !== "object" && typeof obj !== "function") { return { default: obj }; } var cache = _getRequireWildcardCache(nodeInterop); if (cache && cache.has(obj)) { return cache.get(obj); } var newObj = {}; var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var key in obj) { if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) { var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null; if (desc && (desc.get || desc.set)) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } newObj.default = obj; if (cache) { cache.set(obj, newObj); } return newObj; }
// parse XML response for bucket region
function parseBucketRegion(xml) {
  // return region information
  return (0, _helper.parseXml)(xml).LocationConstraint;
}
const fxp = new _fastXmlParser.XMLParser();

// Parse XML and return information as Javascript types
// parse error XML response
function parseError(xml, headerInfo) {
  let xmlErr = {};
  const xmlObj = fxp.parse(xml);
  if (xmlObj.Error) {
    xmlErr = xmlObj.Error;
  }
  const e = new errors.S3Error();
  Object.entries(xmlErr).forEach(([key, value]) => {
    e[key.toLowerCase()] = value;
  });
  Object.entries(headerInfo).forEach(([key, value]) => {
    e[key] = value;
  });
  return e;
}

// Generates an Error object depending on http statusCode and XML body
async function parseResponseError(response) {
  const statusCode = response.statusCode;
  let code, message;
  if (statusCode === 301) {
    code = 'MovedPermanently';
    message = 'Moved Permanently';
  } else if (statusCode === 307) {
    code = 'TemporaryRedirect';
    message = 'Are you using the correct endpoint URL?';
  } else if (statusCode === 403) {
    code = 'AccessDenied';
    message = 'Valid and authorized credentials required';
  } else if (statusCode === 404) {
    code = 'NotFound';
    message = 'Not Found';
  } else if (statusCode === 405) {
    code = 'MethodNotAllowed';
    message = 'Method Not Allowed';
  } else if (statusCode === 501) {
    code = 'MethodNotAllowed';
    message = 'Method Not Allowed';
  } else {
    code = 'UnknownError';
    message = `${statusCode}`;
  }
  const headerInfo = {};
  // A value created by S3 compatible server that uniquely identifies the request.
  headerInfo.amzRequestid = response.headers['x-amz-request-id'];
  // A special token that helps troubleshoot API replies and issues.
  headerInfo.amzId2 = response.headers['x-amz-id-2'];

  // Region where the bucket is located. This header is returned only
  // in HEAD bucket and ListObjects response.
  headerInfo.amzBucketRegion = response.headers['x-amz-bucket-region'];
  const xmlString = await (0, _response.readAsString)(response);
  if (xmlString) {
    throw parseError(xmlString, headerInfo);
  }

  // Message should be instantiated for each S3Errors.
  const e = new errors.S3Error(message, {
    cause: headerInfo
  });
  // S3 Error code.
  e.code = code;
  Object.entries(headerInfo).forEach(([key, value]) => {
    // @ts-expect-error force set error properties
    e[key] = value;
  });
  throw e;
}

/**
 * parse XML response for list objects v2 with metadata in a bucket
 */
function parseListObjectsV2WithMetadata(xml) {
  const result = {
    objects: [],
    isTruncated: false,
    nextContinuationToken: ''
  };
  let xmlobj = (0, _helper.parseXml)(xml);
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
      const name = (0, _helper.sanitizeObjectKey)(content.Key);
      const lastModified = new Date(content.LastModified);
      const etag = (0, _helper.sanitizeETag)(content.ETag);
      const size = content.Size;
      let metadata;
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
// parse XML response for list parts of an in progress multipart upload
function parseListParts(xml) {
  let xmlobj = (0, _helper.parseXml)(xml);
  const result = {
    isTruncated: false,
    parts: [],
    marker: 0
  };
  if (!xmlobj.ListPartsResult) {
    throw new errors.InvalidXMLError('Missing tag: "ListPartsResult"');
  }
  xmlobj = xmlobj.ListPartsResult;
  if (xmlobj.IsTruncated) {
    result.isTruncated = xmlobj.IsTruncated;
  }
  if (xmlobj.NextPartNumberMarker) {
    result.marker = (0, _helper.toArray)(xmlobj.NextPartNumberMarker)[0] || '';
  }
  if (xmlobj.Part) {
    (0, _helper.toArray)(xmlobj.Part).forEach(p => {
      const part = parseInt((0, _helper.toArray)(p.PartNumber)[0], 10);
      const lastModified = new Date(p.LastModified);
      const etag = p.ETag.replace(/^"/g, '').replace(/"$/g, '').replace(/^&quot;/g, '').replace(/&quot;$/g, '').replace(/^&#34;/g, '').replace(/&#34;$/g, '');
      result.parts.push({
        part,
        lastModified,
        etag,
        size: parseInt(p.Size, 10)
      });
    });
  }
  return result;
}
function parseListBucket(xml) {
  let result = [];
  const parsedXmlRes = (0, _helper.parseXml)(xml);
  if (!parsedXmlRes.ListAllMyBucketsResult) {
    throw new errors.InvalidXMLError('Missing tag: "ListAllMyBucketsResult"');
  }
  const {
    ListAllMyBucketsResult: {
      Buckets = {}
    } = {}
  } = parsedXmlRes;
  if (Buckets.Bucket) {
    result = (0, _helper.toArray)(Buckets.Bucket).map((bucket = {}) => {
      const {
        Name: bucketName,
        CreationDate
      } = bucket;
      const creationDate = new Date(CreationDate);
      return {
        name: bucketName,
        creationDate: creationDate
      };
    });
  }
  return result;
}
function parseInitiateMultipart(xml) {
  let xmlobj = (0, _helper.parseXml)(xml);
  if (!xmlobj.InitiateMultipartUploadResult) {
    throw new errors.InvalidXMLError('Missing tag: "InitiateMultipartUploadResult"');
  }
  xmlobj = xmlobj.InitiateMultipartUploadResult;
  if (xmlobj.UploadId) {
    return xmlobj.UploadId;
  }
  throw new errors.InvalidXMLError('Missing tag: "UploadId"');
}
function parseReplicationConfig(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  const {
    Role,
    Rule
  } = xmlObj.ReplicationConfiguration;
  return {
    ReplicationConfiguration: {
      role: Role,
      rules: (0, _helper.toArray)(Rule)
    }
  };
}
function parseObjectLegalHoldConfig(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  return xmlObj.LegalHold;
}
function parseTagging(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  let result = [];
  if (xmlObj.Tagging && xmlObj.Tagging.TagSet && xmlObj.Tagging.TagSet.Tag) {
    const tagResult = xmlObj.Tagging.TagSet.Tag;
    // if it is a single tag convert into an array so that the return value is always an array.
    if ((0, _helper.isObject)(tagResult)) {
      result.push(tagResult);
    } else {
      result = tagResult;
    }
  }
  return result;
}

// parse XML response when a multipart upload is completed
function parseCompleteMultipart(xml) {
  const xmlobj = (0, _helper.parseXml)(xml).CompleteMultipartUploadResult;
  if (xmlobj.Location) {
    const location = (0, _helper.toArray)(xmlobj.Location)[0];
    const bucket = (0, _helper.toArray)(xmlobj.Bucket)[0];
    const key = xmlobj.Key;
    const etag = xmlobj.ETag.replace(/^"/g, '').replace(/"$/g, '').replace(/^&quot;/g, '').replace(/&quot;$/g, '').replace(/^&#34;/g, '').replace(/&#34;$/g, '');
    return {
      location,
      bucket,
      key,
      etag
    };
  }
  // Complete Multipart can return XML Error after a 200 OK response
  if (xmlobj.Code && xmlobj.Message) {
    const errCode = (0, _helper.toArray)(xmlobj.Code)[0];
    const errMessage = (0, _helper.toArray)(xmlobj.Message)[0];
    return {
      errCode,
      errMessage
    };
  }
}
// parse XML response for listing in-progress multipart uploads
function parseListMultipart(xml) {
  const result = {
    prefixes: [],
    uploads: [],
    isTruncated: false,
    nextKeyMarker: '',
    nextUploadIdMarker: ''
  };
  let xmlobj = (0, _helper.parseXml)(xml);
  if (!xmlobj.ListMultipartUploadsResult) {
    throw new errors.InvalidXMLError('Missing tag: "ListMultipartUploadsResult"');
  }
  xmlobj = xmlobj.ListMultipartUploadsResult;
  if (xmlobj.IsTruncated) {
    result.isTruncated = xmlobj.IsTruncated;
  }
  if (xmlobj.NextKeyMarker) {
    result.nextKeyMarker = xmlobj.NextKeyMarker;
  }
  if (xmlobj.NextUploadIdMarker) {
    result.nextUploadIdMarker = xmlobj.nextUploadIdMarker || '';
  }
  if (xmlobj.CommonPrefixes) {
    (0, _helper.toArray)(xmlobj.CommonPrefixes).forEach(prefix => {
      // @ts-expect-error index check
      result.prefixes.push({
        prefix: (0, _helper.sanitizeObjectKey)((0, _helper.toArray)(prefix.Prefix)[0])
      });
    });
  }
  if (xmlobj.Upload) {
    (0, _helper.toArray)(xmlobj.Upload).forEach(upload => {
      const key = upload.Key;
      const uploadId = upload.UploadId;
      const initiator = {
        id: upload.Initiator.ID,
        displayName: upload.Initiator.DisplayName
      };
      const owner = {
        id: upload.Owner.ID,
        displayName: upload.Owner.DisplayName
      };
      const storageClass = upload.StorageClass;
      const initiated = new Date(upload.Initiated);
      result.uploads.push({
        key,
        uploadId,
        initiator,
        owner,
        storageClass,
        initiated
      });
    });
  }
  return result;
}
function parseObjectLockConfig(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  let lockConfigResult = {};
  if (xmlObj.ObjectLockConfiguration) {
    lockConfigResult = {
      objectLockEnabled: xmlObj.ObjectLockConfiguration.ObjectLockEnabled
    };
    let retentionResp;
    if (xmlObj.ObjectLockConfiguration && xmlObj.ObjectLockConfiguration.Rule && xmlObj.ObjectLockConfiguration.Rule.DefaultRetention) {
      retentionResp = xmlObj.ObjectLockConfiguration.Rule.DefaultRetention || {};
      lockConfigResult.mode = retentionResp.Mode;
    }
    if (retentionResp) {
      const isUnitYears = retentionResp.Years;
      if (isUnitYears) {
        lockConfigResult.validity = isUnitYears;
        lockConfigResult.unit = _type.RETENTION_VALIDITY_UNITS.YEARS;
      } else {
        lockConfigResult.validity = retentionResp.Days;
        lockConfigResult.unit = _type.RETENTION_VALIDITY_UNITS.DAYS;
      }
    }
  }
  return lockConfigResult;
}
function parseBucketVersioningConfig(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  return xmlObj.VersioningConfiguration;
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfZmFzdFhtbFBhcnNlciIsInJlcXVpcmUiLCJlcnJvcnMiLCJfaW50ZXJvcFJlcXVpcmVXaWxkY2FyZCIsIl9oZWxwZXIiLCJfcmVzcG9uc2UiLCJfdHlwZSIsIl9nZXRSZXF1aXJlV2lsZGNhcmRDYWNoZSIsIm5vZGVJbnRlcm9wIiwiV2Vha01hcCIsImNhY2hlQmFiZWxJbnRlcm9wIiwiY2FjaGVOb2RlSW50ZXJvcCIsIm9iaiIsIl9fZXNNb2R1bGUiLCJkZWZhdWx0IiwiY2FjaGUiLCJoYXMiLCJnZXQiLCJuZXdPYmoiLCJoYXNQcm9wZXJ0eURlc2NyaXB0b3IiLCJPYmplY3QiLCJkZWZpbmVQcm9wZXJ0eSIsImdldE93blByb3BlcnR5RGVzY3JpcHRvciIsImtleSIsInByb3RvdHlwZSIsImhhc093blByb3BlcnR5IiwiY2FsbCIsImRlc2MiLCJzZXQiLCJwYXJzZUJ1Y2tldFJlZ2lvbiIsInhtbCIsInBhcnNlWG1sIiwiTG9jYXRpb25Db25zdHJhaW50IiwiZnhwIiwiWE1MUGFyc2VyIiwicGFyc2VFcnJvciIsImhlYWRlckluZm8iLCJ4bWxFcnIiLCJ4bWxPYmoiLCJwYXJzZSIsIkVycm9yIiwiZSIsIlMzRXJyb3IiLCJlbnRyaWVzIiwiZm9yRWFjaCIsInZhbHVlIiwidG9Mb3dlckNhc2UiLCJwYXJzZVJlc3BvbnNlRXJyb3IiLCJyZXNwb25zZSIsInN0YXR1c0NvZGUiLCJjb2RlIiwibWVzc2FnZSIsImFtelJlcXVlc3RpZCIsImhlYWRlcnMiLCJhbXpJZDIiLCJhbXpCdWNrZXRSZWdpb24iLCJ4bWxTdHJpbmciLCJyZWFkQXNTdHJpbmciLCJjYXVzZSIsInBhcnNlTGlzdE9iamVjdHNWMldpdGhNZXRhZGF0YSIsInJlc3VsdCIsIm9iamVjdHMiLCJpc1RydW5jYXRlZCIsIm5leHRDb250aW51YXRpb25Ub2tlbiIsInhtbG9iaiIsIkxpc3RCdWNrZXRSZXN1bHQiLCJJbnZhbGlkWE1MRXJyb3IiLCJJc1RydW5jYXRlZCIsIk5leHRDb250aW51YXRpb25Ub2tlbiIsIkNvbnRlbnRzIiwidG9BcnJheSIsImNvbnRlbnQiLCJuYW1lIiwic2FuaXRpemVPYmplY3RLZXkiLCJLZXkiLCJsYXN0TW9kaWZpZWQiLCJEYXRlIiwiTGFzdE1vZGlmaWVkIiwiZXRhZyIsInNhbml0aXplRVRhZyIsIkVUYWciLCJzaXplIiwiU2l6ZSIsIm1ldGFkYXRhIiwiVXNlck1ldGFkYXRhIiwicHVzaCIsIkNvbW1vblByZWZpeGVzIiwiY29tbW9uUHJlZml4IiwicHJlZml4IiwiUHJlZml4IiwicGFyc2VMaXN0UGFydHMiLCJwYXJ0cyIsIm1hcmtlciIsIkxpc3RQYXJ0c1Jlc3VsdCIsIk5leHRQYXJ0TnVtYmVyTWFya2VyIiwiUGFydCIsInAiLCJwYXJ0IiwicGFyc2VJbnQiLCJQYXJ0TnVtYmVyIiwicmVwbGFjZSIsInBhcnNlTGlzdEJ1Y2tldCIsInBhcnNlZFhtbFJlcyIsIkxpc3RBbGxNeUJ1Y2tldHNSZXN1bHQiLCJCdWNrZXRzIiwiQnVja2V0IiwibWFwIiwiYnVja2V0IiwiTmFtZSIsImJ1Y2tldE5hbWUiLCJDcmVhdGlvbkRhdGUiLCJjcmVhdGlvbkRhdGUiLCJwYXJzZUluaXRpYXRlTXVsdGlwYXJ0IiwiSW5pdGlhdGVNdWx0aXBhcnRVcGxvYWRSZXN1bHQiLCJVcGxvYWRJZCIsInBhcnNlUmVwbGljYXRpb25Db25maWciLCJSb2xlIiwiUnVsZSIsIlJlcGxpY2F0aW9uQ29uZmlndXJhdGlvbiIsInJvbGUiLCJydWxlcyIsInBhcnNlT2JqZWN0TGVnYWxIb2xkQ29uZmlnIiwiTGVnYWxIb2xkIiwicGFyc2VUYWdnaW5nIiwiVGFnZ2luZyIsIlRhZ1NldCIsIlRhZyIsInRhZ1Jlc3VsdCIsImlzT2JqZWN0IiwicGFyc2VDb21wbGV0ZU11bHRpcGFydCIsIkNvbXBsZXRlTXVsdGlwYXJ0VXBsb2FkUmVzdWx0IiwiTG9jYXRpb24iLCJsb2NhdGlvbiIsIkNvZGUiLCJNZXNzYWdlIiwiZXJyQ29kZSIsImVyck1lc3NhZ2UiLCJwYXJzZUxpc3RNdWx0aXBhcnQiLCJwcmVmaXhlcyIsInVwbG9hZHMiLCJuZXh0S2V5TWFya2VyIiwibmV4dFVwbG9hZElkTWFya2VyIiwiTGlzdE11bHRpcGFydFVwbG9hZHNSZXN1bHQiLCJOZXh0S2V5TWFya2VyIiwiTmV4dFVwbG9hZElkTWFya2VyIiwiVXBsb2FkIiwidXBsb2FkIiwidXBsb2FkSWQiLCJpbml0aWF0b3IiLCJpZCIsIkluaXRpYXRvciIsIklEIiwiZGlzcGxheU5hbWUiLCJEaXNwbGF5TmFtZSIsIm93bmVyIiwiT3duZXIiLCJzdG9yYWdlQ2xhc3MiLCJTdG9yYWdlQ2xhc3MiLCJpbml0aWF0ZWQiLCJJbml0aWF0ZWQiLCJwYXJzZU9iamVjdExvY2tDb25maWciLCJsb2NrQ29uZmlnUmVzdWx0IiwiT2JqZWN0TG9ja0NvbmZpZ3VyYXRpb24iLCJvYmplY3RMb2NrRW5hYmxlZCIsIk9iamVjdExvY2tFbmFibGVkIiwicmV0ZW50aW9uUmVzcCIsIkRlZmF1bHRSZXRlbnRpb24iLCJtb2RlIiwiTW9kZSIsImlzVW5pdFllYXJzIiwiWWVhcnMiLCJ2YWxpZGl0eSIsInVuaXQiLCJSRVRFTlRJT05fVkFMSURJVFlfVU5JVFMiLCJZRUFSUyIsIkRheXMiLCJEQVlTIiwicGFyc2VCdWNrZXRWZXJzaW9uaW5nQ29uZmlnIiwiVmVyc2lvbmluZ0NvbmZpZ3VyYXRpb24iXSwic291cmNlcyI6WyJ4bWwtcGFyc2VyLnRzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlICogYXMgaHR0cCBmcm9tICdub2RlOmh0dHAnXG5cbmltcG9ydCB7IFhNTFBhcnNlciB9IGZyb20gJ2Zhc3QteG1sLXBhcnNlcidcblxuaW1wb3J0ICogYXMgZXJyb3JzIGZyb20gJy4uL2Vycm9ycy50cydcbmltcG9ydCB7IGlzT2JqZWN0LCBwYXJzZVhtbCwgc2FuaXRpemVFVGFnLCBzYW5pdGl6ZU9iamVjdEtleSwgdG9BcnJheSB9IGZyb20gJy4vaGVscGVyLnRzJ1xuaW1wb3J0IHsgcmVhZEFzU3RyaW5nIH0gZnJvbSAnLi9yZXNwb25zZS50cydcbmltcG9ydCB0eXBlIHsgQnVja2V0SXRlbUZyb21MaXN0LCBCdWNrZXRJdGVtV2l0aE1ldGFkYXRhLCBPYmplY3RMb2NrSW5mbywgUmVwbGljYXRpb25Db25maWcgfSBmcm9tICcuL3R5cGUudHMnXG5pbXBvcnQgeyBSRVRFTlRJT05fVkFMSURJVFlfVU5JVFMgfSBmcm9tICcuL3R5cGUudHMnXG5cbi8vIHBhcnNlIFhNTCByZXNwb25zZSBmb3IgYnVja2V0IHJlZ2lvblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlQnVja2V0UmVnaW9uKHhtbDogc3RyaW5nKTogc3RyaW5nIHtcbiAgLy8gcmV0dXJuIHJlZ2lvbiBpbmZvcm1hdGlvblxuICByZXR1cm4gcGFyc2VYbWwoeG1sKS5Mb2NhdGlvbkNvbnN0cmFpbnRcbn1cblxuY29uc3QgZnhwID0gbmV3IFhNTFBhcnNlcigpXG5cbi8vIFBhcnNlIFhNTCBhbmQgcmV0dXJuIGluZm9ybWF0aW9uIGFzIEphdmFzY3JpcHQgdHlwZXNcbi8vIHBhcnNlIGVycm9yIFhNTCByZXNwb25zZVxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlRXJyb3IoeG1sOiBzdHJpbmcsIGhlYWRlckluZm86IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSB7XG4gIGxldCB4bWxFcnIgPSB7fVxuICBjb25zdCB4bWxPYmogPSBmeHAucGFyc2UoeG1sKVxuICBpZiAoeG1sT2JqLkVycm9yKSB7XG4gICAgeG1sRXJyID0geG1sT2JqLkVycm9yXG4gIH1cbiAgY29uc3QgZSA9IG5ldyBlcnJvcnMuUzNFcnJvcigpIGFzIHVua25vd24gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj5cbiAgT2JqZWN0LmVudHJpZXMoeG1sRXJyKS5mb3JFYWNoKChba2V5LCB2YWx1ZV0pID0+IHtcbiAgICBlW2tleS50b0xvd2VyQ2FzZSgpXSA9IHZhbHVlXG4gIH0pXG4gIE9iamVjdC5lbnRyaWVzKGhlYWRlckluZm8pLmZvckVhY2goKFtrZXksIHZhbHVlXSkgPT4ge1xuICAgIGVba2V5XSA9IHZhbHVlXG4gIH0pXG4gIHJldHVybiBlXG59XG5cbi8vIEdlbmVyYXRlcyBhbiBFcnJvciBvYmplY3QgZGVwZW5kaW5nIG9uIGh0dHAgc3RhdHVzQ29kZSBhbmQgWE1MIGJvZHlcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBwYXJzZVJlc3BvbnNlRXJyb3IocmVzcG9uc2U6IGh0dHAuSW5jb21pbmdNZXNzYWdlKSB7XG4gIGNvbnN0IHN0YXR1c0NvZGUgPSByZXNwb25zZS5zdGF0dXNDb2RlXG4gIGxldCBjb2RlOiBzdHJpbmcsIG1lc3NhZ2U6IHN0cmluZ1xuICBpZiAoc3RhdHVzQ29kZSA9PT0gMzAxKSB7XG4gICAgY29kZSA9ICdNb3ZlZFBlcm1hbmVudGx5J1xuICAgIG1lc3NhZ2UgPSAnTW92ZWQgUGVybWFuZW50bHknXG4gIH0gZWxzZSBpZiAoc3RhdHVzQ29kZSA9PT0gMzA3KSB7XG4gICAgY29kZSA9ICdUZW1wb3JhcnlSZWRpcmVjdCdcbiAgICBtZXNzYWdlID0gJ0FyZSB5b3UgdXNpbmcgdGhlIGNvcnJlY3QgZW5kcG9pbnQgVVJMPydcbiAgfSBlbHNlIGlmIChzdGF0dXNDb2RlID09PSA0MDMpIHtcbiAgICBjb2RlID0gJ0FjY2Vzc0RlbmllZCdcbiAgICBtZXNzYWdlID0gJ1ZhbGlkIGFuZCBhdXRob3JpemVkIGNyZWRlbnRpYWxzIHJlcXVpcmVkJ1xuICB9IGVsc2UgaWYgKHN0YXR1c0NvZGUgPT09IDQwNCkge1xuICAgIGNvZGUgPSAnTm90Rm91bmQnXG4gICAgbWVzc2FnZSA9ICdOb3QgRm91bmQnXG4gIH0gZWxzZSBpZiAoc3RhdHVzQ29kZSA9PT0gNDA1KSB7XG4gICAgY29kZSA9ICdNZXRob2ROb3RBbGxvd2VkJ1xuICAgIG1lc3NhZ2UgPSAnTWV0aG9kIE5vdCBBbGxvd2VkJ1xuICB9IGVsc2UgaWYgKHN0YXR1c0NvZGUgPT09IDUwMSkge1xuICAgIGNvZGUgPSAnTWV0aG9kTm90QWxsb3dlZCdcbiAgICBtZXNzYWdlID0gJ01ldGhvZCBOb3QgQWxsb3dlZCdcbiAgfSBlbHNlIHtcbiAgICBjb2RlID0gJ1Vua25vd25FcnJvcidcbiAgICBtZXNzYWdlID0gYCR7c3RhdHVzQ29kZX1gXG4gIH1cbiAgY29uc3QgaGVhZGVySW5mbzogUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgdW5kZWZpbmVkIHwgbnVsbD4gPSB7fVxuICAvLyBBIHZhbHVlIGNyZWF0ZWQgYnkgUzMgY29tcGF0aWJsZSBzZXJ2ZXIgdGhhdCB1bmlxdWVseSBpZGVudGlmaWVzIHRoZSByZXF1ZXN0LlxuICBoZWFkZXJJbmZvLmFtelJlcXVlc3RpZCA9IHJlc3BvbnNlLmhlYWRlcnNbJ3gtYW16LXJlcXVlc3QtaWQnXSBhcyBzdHJpbmcgfCB1bmRlZmluZWRcbiAgLy8gQSBzcGVjaWFsIHRva2VuIHRoYXQgaGVscHMgdHJvdWJsZXNob290IEFQSSByZXBsaWVzIGFuZCBpc3N1ZXMuXG4gIGhlYWRlckluZm8uYW16SWQyID0gcmVzcG9uc2UuaGVhZGVyc1sneC1hbXotaWQtMiddIGFzIHN0cmluZyB8IHVuZGVmaW5lZFxuXG4gIC8vIFJlZ2lvbiB3aGVyZSB0aGUgYnVja2V0IGlzIGxvY2F0ZWQuIFRoaXMgaGVhZGVyIGlzIHJldHVybmVkIG9ubHlcbiAgLy8gaW4gSEVBRCBidWNrZXQgYW5kIExpc3RPYmplY3RzIHJlc3BvbnNlLlxuICBoZWFkZXJJbmZvLmFtekJ1Y2tldFJlZ2lvbiA9IHJlc3BvbnNlLmhlYWRlcnNbJ3gtYW16LWJ1Y2tldC1yZWdpb24nXSBhcyBzdHJpbmcgfCB1bmRlZmluZWRcblxuICBjb25zdCB4bWxTdHJpbmcgPSBhd2FpdCByZWFkQXNTdHJpbmcocmVzcG9uc2UpXG5cbiAgaWYgKHhtbFN0cmluZykge1xuICAgIHRocm93IHBhcnNlRXJyb3IoeG1sU3RyaW5nLCBoZWFkZXJJbmZvKVxuICB9XG5cbiAgLy8gTWVzc2FnZSBzaG91bGQgYmUgaW5zdGFudGlhdGVkIGZvciBlYWNoIFMzRXJyb3JzLlxuICBjb25zdCBlID0gbmV3IGVycm9ycy5TM0Vycm9yKG1lc3NhZ2UsIHsgY2F1c2U6IGhlYWRlckluZm8gfSlcbiAgLy8gUzMgRXJyb3IgY29kZS5cbiAgZS5jb2RlID0gY29kZVxuICBPYmplY3QuZW50cmllcyhoZWFkZXJJbmZvKS5mb3JFYWNoKChba2V5LCB2YWx1ZV0pID0+IHtcbiAgICAvLyBAdHMtZXhwZWN0LWVycm9yIGZvcmNlIHNldCBlcnJvciBwcm9wZXJ0aWVzXG4gICAgZVtrZXldID0gdmFsdWVcbiAgfSlcblxuICB0aHJvdyBlXG59XG5cbi8qKlxuICogcGFyc2UgWE1MIHJlc3BvbnNlIGZvciBsaXN0IG9iamVjdHMgdjIgd2l0aCBtZXRhZGF0YSBpbiBhIGJ1Y2tldFxuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VMaXN0T2JqZWN0c1YyV2l0aE1ldGFkYXRhKHhtbDogc3RyaW5nKSB7XG4gIGNvbnN0IHJlc3VsdDoge1xuICAgIG9iamVjdHM6IEFycmF5PEJ1Y2tldEl0ZW1XaXRoTWV0YWRhdGE+XG4gICAgaXNUcnVuY2F0ZWQ6IGJvb2xlYW5cbiAgICBuZXh0Q29udGludWF0aW9uVG9rZW46IHN0cmluZ1xuICB9ID0ge1xuICAgIG9iamVjdHM6IFtdLFxuICAgIGlzVHJ1bmNhdGVkOiBmYWxzZSxcbiAgICBuZXh0Q29udGludWF0aW9uVG9rZW46ICcnLFxuICB9XG5cbiAgbGV0IHhtbG9iaiA9IHBhcnNlWG1sKHhtbClcbiAgaWYgKCF4bWxvYmouTGlzdEJ1Y2tldFJlc3VsdCkge1xuICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZFhNTEVycm9yKCdNaXNzaW5nIHRhZzogXCJMaXN0QnVja2V0UmVzdWx0XCInKVxuICB9XG4gIHhtbG9iaiA9IHhtbG9iai5MaXN0QnVja2V0UmVzdWx0XG4gIGlmICh4bWxvYmouSXNUcnVuY2F0ZWQpIHtcbiAgICByZXN1bHQuaXNUcnVuY2F0ZWQgPSB4bWxvYmouSXNUcnVuY2F0ZWRcbiAgfVxuICBpZiAoeG1sb2JqLk5leHRDb250aW51YXRpb25Ub2tlbikge1xuICAgIHJlc3VsdC5uZXh0Q29udGludWF0aW9uVG9rZW4gPSB4bWxvYmouTmV4dENvbnRpbnVhdGlvblRva2VuXG4gIH1cblxuICBpZiAoeG1sb2JqLkNvbnRlbnRzKSB7XG4gICAgdG9BcnJheSh4bWxvYmouQ29udGVudHMpLmZvckVhY2goKGNvbnRlbnQpID0+IHtcbiAgICAgIGNvbnN0IG5hbWUgPSBzYW5pdGl6ZU9iamVjdEtleShjb250ZW50LktleSlcbiAgICAgIGNvbnN0IGxhc3RNb2RpZmllZCA9IG5ldyBEYXRlKGNvbnRlbnQuTGFzdE1vZGlmaWVkKVxuICAgICAgY29uc3QgZXRhZyA9IHNhbml0aXplRVRhZyhjb250ZW50LkVUYWcpXG4gICAgICBjb25zdCBzaXplID0gY29udGVudC5TaXplXG4gICAgICBsZXQgbWV0YWRhdGFcbiAgICAgIGlmIChjb250ZW50LlVzZXJNZXRhZGF0YSAhPSBudWxsKSB7XG4gICAgICAgIG1ldGFkYXRhID0gdG9BcnJheShjb250ZW50LlVzZXJNZXRhZGF0YSlbMF1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG1ldGFkYXRhID0gbnVsbFxuICAgICAgfVxuICAgICAgcmVzdWx0Lm9iamVjdHMucHVzaCh7IG5hbWUsIGxhc3RNb2RpZmllZCwgZXRhZywgc2l6ZSwgbWV0YWRhdGEgfSlcbiAgICB9KVxuICB9XG5cbiAgaWYgKHhtbG9iai5Db21tb25QcmVmaXhlcykge1xuICAgIHRvQXJyYXkoeG1sb2JqLkNvbW1vblByZWZpeGVzKS5mb3JFYWNoKChjb21tb25QcmVmaXgpID0+IHtcbiAgICAgIHJlc3VsdC5vYmplY3RzLnB1c2goeyBwcmVmaXg6IHNhbml0aXplT2JqZWN0S2V5KHRvQXJyYXkoY29tbW9uUHJlZml4LlByZWZpeClbMF0pLCBzaXplOiAwIH0pXG4gICAgfSlcbiAgfVxuICByZXR1cm4gcmVzdWx0XG59XG5cbmV4cG9ydCB0eXBlIE11bHRpcGFydCA9IHtcbiAgdXBsb2FkczogQXJyYXk8e1xuICAgIGtleTogc3RyaW5nXG4gICAgdXBsb2FkSWQ6IHN0cmluZ1xuICAgIGluaXRpYXRvcjogdW5rbm93blxuICAgIG93bmVyOiB1bmtub3duXG4gICAgc3RvcmFnZUNsYXNzOiB1bmtub3duXG4gICAgaW5pdGlhdGVkOiB1bmtub3duXG4gIH0+XG4gIHByZWZpeGVzOiB7XG4gICAgcHJlZml4OiBzdHJpbmdcbiAgfVtdXG4gIGlzVHJ1bmNhdGVkOiBib29sZWFuXG4gIG5leHRLZXlNYXJrZXI6IHVuZGVmaW5lZFxuICBuZXh0VXBsb2FkSWRNYXJrZXI6IHVuZGVmaW5lZFxufVxuXG5leHBvcnQgdHlwZSBVcGxvYWRlZFBhcnQgPSB7XG4gIHBhcnQ6IG51bWJlclxuICBsYXN0TW9kaWZpZWQ/OiBEYXRlXG4gIGV0YWc6IHN0cmluZ1xuICBzaXplOiBudW1iZXJcbn1cblxuLy8gcGFyc2UgWE1MIHJlc3BvbnNlIGZvciBsaXN0IHBhcnRzIG9mIGFuIGluIHByb2dyZXNzIG11bHRpcGFydCB1cGxvYWRcbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUxpc3RQYXJ0cyh4bWw6IHN0cmluZyk6IHtcbiAgaXNUcnVuY2F0ZWQ6IGJvb2xlYW5cbiAgbWFya2VyOiBudW1iZXJcbiAgcGFydHM6IFVwbG9hZGVkUGFydFtdXG59IHtcbiAgbGV0IHhtbG9iaiA9IHBhcnNlWG1sKHhtbClcbiAgY29uc3QgcmVzdWx0OiB7XG4gICAgaXNUcnVuY2F0ZWQ6IGJvb2xlYW5cbiAgICBtYXJrZXI6IG51bWJlclxuICAgIHBhcnRzOiBVcGxvYWRlZFBhcnRbXVxuICB9ID0ge1xuICAgIGlzVHJ1bmNhdGVkOiBmYWxzZSxcbiAgICBwYXJ0czogW10sXG4gICAgbWFya2VyOiAwLFxuICB9XG4gIGlmICgheG1sb2JqLkxpc3RQYXJ0c1Jlc3VsdCkge1xuICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZFhNTEVycm9yKCdNaXNzaW5nIHRhZzogXCJMaXN0UGFydHNSZXN1bHRcIicpXG4gIH1cbiAgeG1sb2JqID0geG1sb2JqLkxpc3RQYXJ0c1Jlc3VsdFxuICBpZiAoeG1sb2JqLklzVHJ1bmNhdGVkKSB7XG4gICAgcmVzdWx0LmlzVHJ1bmNhdGVkID0geG1sb2JqLklzVHJ1bmNhdGVkXG4gIH1cbiAgaWYgKHhtbG9iai5OZXh0UGFydE51bWJlck1hcmtlcikge1xuICAgIHJlc3VsdC5tYXJrZXIgPSB0b0FycmF5KHhtbG9iai5OZXh0UGFydE51bWJlck1hcmtlcilbMF0gfHwgJydcbiAgfVxuICBpZiAoeG1sb2JqLlBhcnQpIHtcbiAgICB0b0FycmF5KHhtbG9iai5QYXJ0KS5mb3JFYWNoKChwKSA9PiB7XG4gICAgICBjb25zdCBwYXJ0ID0gcGFyc2VJbnQodG9BcnJheShwLlBhcnROdW1iZXIpWzBdLCAxMClcbiAgICAgIGNvbnN0IGxhc3RNb2RpZmllZCA9IG5ldyBEYXRlKHAuTGFzdE1vZGlmaWVkKVxuICAgICAgY29uc3QgZXRhZyA9IHAuRVRhZy5yZXBsYWNlKC9eXCIvZywgJycpXG4gICAgICAgIC5yZXBsYWNlKC9cIiQvZywgJycpXG4gICAgICAgIC5yZXBsYWNlKC9eJnF1b3Q7L2csICcnKVxuICAgICAgICAucmVwbGFjZSgvJnF1b3Q7JC9nLCAnJylcbiAgICAgICAgLnJlcGxhY2UoL14mIzM0Oy9nLCAnJylcbiAgICAgICAgLnJlcGxhY2UoLyYjMzQ7JC9nLCAnJylcbiAgICAgIHJlc3VsdC5wYXJ0cy5wdXNoKHsgcGFydCwgbGFzdE1vZGlmaWVkLCBldGFnLCBzaXplOiBwYXJzZUludChwLlNpemUsIDEwKSB9KVxuICAgIH0pXG4gIH1cbiAgcmV0dXJuIHJlc3VsdFxufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VMaXN0QnVja2V0KHhtbDogc3RyaW5nKSB7XG4gIGxldCByZXN1bHQ6IEJ1Y2tldEl0ZW1Gcm9tTGlzdFtdID0gW11cbiAgY29uc3QgcGFyc2VkWG1sUmVzID0gcGFyc2VYbWwoeG1sKVxuXG4gIGlmICghcGFyc2VkWG1sUmVzLkxpc3RBbGxNeUJ1Y2tldHNSZXN1bHQpIHtcbiAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRYTUxFcnJvcignTWlzc2luZyB0YWc6IFwiTGlzdEFsbE15QnVja2V0c1Jlc3VsdFwiJylcbiAgfVxuICBjb25zdCB7IExpc3RBbGxNeUJ1Y2tldHNSZXN1bHQ6IHsgQnVja2V0cyA9IHt9IH0gPSB7fSB9ID0gcGFyc2VkWG1sUmVzXG5cbiAgaWYgKEJ1Y2tldHMuQnVja2V0KSB7XG4gICAgcmVzdWx0ID0gdG9BcnJheShCdWNrZXRzLkJ1Y2tldCkubWFwKChidWNrZXQgPSB7fSkgPT4ge1xuICAgICAgY29uc3QgeyBOYW1lOiBidWNrZXROYW1lLCBDcmVhdGlvbkRhdGUgfSA9IGJ1Y2tldFxuICAgICAgY29uc3QgY3JlYXRpb25EYXRlID0gbmV3IERhdGUoQ3JlYXRpb25EYXRlKVxuXG4gICAgICByZXR1cm4geyBuYW1lOiBidWNrZXROYW1lLCBjcmVhdGlvbkRhdGU6IGNyZWF0aW9uRGF0ZSB9XG4gICAgfSlcbiAgfVxuICByZXR1cm4gcmVzdWx0XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUluaXRpYXRlTXVsdGlwYXJ0KHhtbDogc3RyaW5nKTogc3RyaW5nIHtcbiAgbGV0IHhtbG9iaiA9IHBhcnNlWG1sKHhtbClcblxuICBpZiAoIXhtbG9iai5Jbml0aWF0ZU11bHRpcGFydFVwbG9hZFJlc3VsdCkge1xuICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZFhNTEVycm9yKCdNaXNzaW5nIHRhZzogXCJJbml0aWF0ZU11bHRpcGFydFVwbG9hZFJlc3VsdFwiJylcbiAgfVxuICB4bWxvYmogPSB4bWxvYmouSW5pdGlhdGVNdWx0aXBhcnRVcGxvYWRSZXN1bHRcblxuICBpZiAoeG1sb2JqLlVwbG9hZElkKSB7XG4gICAgcmV0dXJuIHhtbG9iai5VcGxvYWRJZFxuICB9XG4gIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZFhNTEVycm9yKCdNaXNzaW5nIHRhZzogXCJVcGxvYWRJZFwiJylcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlUmVwbGljYXRpb25Db25maWcoeG1sOiBzdHJpbmcpOiBSZXBsaWNhdGlvbkNvbmZpZyB7XG4gIGNvbnN0IHhtbE9iaiA9IHBhcnNlWG1sKHhtbClcbiAgY29uc3QgeyBSb2xlLCBSdWxlIH0gPSB4bWxPYmouUmVwbGljYXRpb25Db25maWd1cmF0aW9uXG4gIHJldHVybiB7XG4gICAgUmVwbGljYXRpb25Db25maWd1cmF0aW9uOiB7XG4gICAgICByb2xlOiBSb2xlLFxuICAgICAgcnVsZXM6IHRvQXJyYXkoUnVsZSksXG4gICAgfSxcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VPYmplY3RMZWdhbEhvbGRDb25maWcoeG1sOiBzdHJpbmcpIHtcbiAgY29uc3QgeG1sT2JqID0gcGFyc2VYbWwoeG1sKVxuICByZXR1cm4geG1sT2JqLkxlZ2FsSG9sZFxufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VUYWdnaW5nKHhtbDogc3RyaW5nKSB7XG4gIGNvbnN0IHhtbE9iaiA9IHBhcnNlWG1sKHhtbClcbiAgbGV0IHJlc3VsdCA9IFtdXG4gIGlmICh4bWxPYmouVGFnZ2luZyAmJiB4bWxPYmouVGFnZ2luZy5UYWdTZXQgJiYgeG1sT2JqLlRhZ2dpbmcuVGFnU2V0LlRhZykge1xuICAgIGNvbnN0IHRhZ1Jlc3VsdCA9IHhtbE9iai5UYWdnaW5nLlRhZ1NldC5UYWdcbiAgICAvLyBpZiBpdCBpcyBhIHNpbmdsZSB0YWcgY29udmVydCBpbnRvIGFuIGFycmF5IHNvIHRoYXQgdGhlIHJldHVybiB2YWx1ZSBpcyBhbHdheXMgYW4gYXJyYXkuXG4gICAgaWYgKGlzT2JqZWN0KHRhZ1Jlc3VsdCkpIHtcbiAgICAgIHJlc3VsdC5wdXNoKHRhZ1Jlc3VsdClcbiAgICB9IGVsc2Uge1xuICAgICAgcmVzdWx0ID0gdGFnUmVzdWx0XG4gICAgfVxuICB9XG4gIHJldHVybiByZXN1bHRcbn1cblxuLy8gcGFyc2UgWE1MIHJlc3BvbnNlIHdoZW4gYSBtdWx0aXBhcnQgdXBsb2FkIGlzIGNvbXBsZXRlZFxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlQ29tcGxldGVNdWx0aXBhcnQoeG1sOiBzdHJpbmcpIHtcbiAgY29uc3QgeG1sb2JqID0gcGFyc2VYbWwoeG1sKS5Db21wbGV0ZU11bHRpcGFydFVwbG9hZFJlc3VsdFxuICBpZiAoeG1sb2JqLkxvY2F0aW9uKSB7XG4gICAgY29uc3QgbG9jYXRpb24gPSB0b0FycmF5KHhtbG9iai5Mb2NhdGlvbilbMF1cbiAgICBjb25zdCBidWNrZXQgPSB0b0FycmF5KHhtbG9iai5CdWNrZXQpWzBdXG4gICAgY29uc3Qga2V5ID0geG1sb2JqLktleVxuICAgIGNvbnN0IGV0YWcgPSB4bWxvYmouRVRhZy5yZXBsYWNlKC9eXCIvZywgJycpXG4gICAgICAucmVwbGFjZSgvXCIkL2csICcnKVxuICAgICAgLnJlcGxhY2UoL14mcXVvdDsvZywgJycpXG4gICAgICAucmVwbGFjZSgvJnF1b3Q7JC9nLCAnJylcbiAgICAgIC5yZXBsYWNlKC9eJiMzNDsvZywgJycpXG4gICAgICAucmVwbGFjZSgvJiMzNDskL2csICcnKVxuXG4gICAgcmV0dXJuIHsgbG9jYXRpb24sIGJ1Y2tldCwga2V5LCBldGFnIH1cbiAgfVxuICAvLyBDb21wbGV0ZSBNdWx0aXBhcnQgY2FuIHJldHVybiBYTUwgRXJyb3IgYWZ0ZXIgYSAyMDAgT0sgcmVzcG9uc2VcbiAgaWYgKHhtbG9iai5Db2RlICYmIHhtbG9iai5NZXNzYWdlKSB7XG4gICAgY29uc3QgZXJyQ29kZSA9IHRvQXJyYXkoeG1sb2JqLkNvZGUpWzBdXG4gICAgY29uc3QgZXJyTWVzc2FnZSA9IHRvQXJyYXkoeG1sb2JqLk1lc3NhZ2UpWzBdXG4gICAgcmV0dXJuIHsgZXJyQ29kZSwgZXJyTWVzc2FnZSB9XG4gIH1cbn1cblxudHlwZSBVcGxvYWRJRCA9IHN0cmluZ1xuXG5leHBvcnQgdHlwZSBMaXN0TXVsdGlwYXJ0UmVzdWx0ID0ge1xuICB1cGxvYWRzOiB7XG4gICAga2V5OiBzdHJpbmdcbiAgICB1cGxvYWRJZDogVXBsb2FkSURcbiAgICBpbml0aWF0b3I6IHVua25vd25cbiAgICBvd25lcjogdW5rbm93blxuICAgIHN0b3JhZ2VDbGFzczogdW5rbm93blxuICAgIGluaXRpYXRlZDogRGF0ZVxuICB9W11cbiAgcHJlZml4ZXM6IHtcbiAgICBwcmVmaXg6IHN0cmluZ1xuICB9W11cbiAgaXNUcnVuY2F0ZWQ6IGJvb2xlYW5cbiAgbmV4dEtleU1hcmtlcjogc3RyaW5nXG4gIG5leHRVcGxvYWRJZE1hcmtlcjogc3RyaW5nXG59XG5cbi8vIHBhcnNlIFhNTCByZXNwb25zZSBmb3IgbGlzdGluZyBpbi1wcm9ncmVzcyBtdWx0aXBhcnQgdXBsb2Fkc1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlTGlzdE11bHRpcGFydCh4bWw6IHN0cmluZyk6IExpc3RNdWx0aXBhcnRSZXN1bHQge1xuICBjb25zdCByZXN1bHQ6IExpc3RNdWx0aXBhcnRSZXN1bHQgPSB7XG4gICAgcHJlZml4ZXM6IFtdLFxuICAgIHVwbG9hZHM6IFtdLFxuICAgIGlzVHJ1bmNhdGVkOiBmYWxzZSxcbiAgICBuZXh0S2V5TWFya2VyOiAnJyxcbiAgICBuZXh0VXBsb2FkSWRNYXJrZXI6ICcnLFxuICB9XG5cbiAgbGV0IHhtbG9iaiA9IHBhcnNlWG1sKHhtbClcblxuICBpZiAoIXhtbG9iai5MaXN0TXVsdGlwYXJ0VXBsb2Fkc1Jlc3VsdCkge1xuICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZFhNTEVycm9yKCdNaXNzaW5nIHRhZzogXCJMaXN0TXVsdGlwYXJ0VXBsb2Fkc1Jlc3VsdFwiJylcbiAgfVxuICB4bWxvYmogPSB4bWxvYmouTGlzdE11bHRpcGFydFVwbG9hZHNSZXN1bHRcbiAgaWYgKHhtbG9iai5Jc1RydW5jYXRlZCkge1xuICAgIHJlc3VsdC5pc1RydW5jYXRlZCA9IHhtbG9iai5Jc1RydW5jYXRlZFxuICB9XG4gIGlmICh4bWxvYmouTmV4dEtleU1hcmtlcikge1xuICAgIHJlc3VsdC5uZXh0S2V5TWFya2VyID0geG1sb2JqLk5leHRLZXlNYXJrZXJcbiAgfVxuICBpZiAoeG1sb2JqLk5leHRVcGxvYWRJZE1hcmtlcikge1xuICAgIHJlc3VsdC5uZXh0VXBsb2FkSWRNYXJrZXIgPSB4bWxvYmoubmV4dFVwbG9hZElkTWFya2VyIHx8ICcnXG4gIH1cblxuICBpZiAoeG1sb2JqLkNvbW1vblByZWZpeGVzKSB7XG4gICAgdG9BcnJheSh4bWxvYmouQ29tbW9uUHJlZml4ZXMpLmZvckVhY2goKHByZWZpeCkgPT4ge1xuICAgICAgLy8gQHRzLWV4cGVjdC1lcnJvciBpbmRleCBjaGVja1xuICAgICAgcmVzdWx0LnByZWZpeGVzLnB1c2goeyBwcmVmaXg6IHNhbml0aXplT2JqZWN0S2V5KHRvQXJyYXk8c3RyaW5nPihwcmVmaXguUHJlZml4KVswXSkgfSlcbiAgICB9KVxuICB9XG5cbiAgaWYgKHhtbG9iai5VcGxvYWQpIHtcbiAgICB0b0FycmF5KHhtbG9iai5VcGxvYWQpLmZvckVhY2goKHVwbG9hZCkgPT4ge1xuICAgICAgY29uc3Qga2V5ID0gdXBsb2FkLktleVxuICAgICAgY29uc3QgdXBsb2FkSWQgPSB1cGxvYWQuVXBsb2FkSWRcbiAgICAgIGNvbnN0IGluaXRpYXRvciA9IHsgaWQ6IHVwbG9hZC5Jbml0aWF0b3IuSUQsIGRpc3BsYXlOYW1lOiB1cGxvYWQuSW5pdGlhdG9yLkRpc3BsYXlOYW1lIH1cbiAgICAgIGNvbnN0IG93bmVyID0geyBpZDogdXBsb2FkLk93bmVyLklELCBkaXNwbGF5TmFtZTogdXBsb2FkLk93bmVyLkRpc3BsYXlOYW1lIH1cbiAgICAgIGNvbnN0IHN0b3JhZ2VDbGFzcyA9IHVwbG9hZC5TdG9yYWdlQ2xhc3NcbiAgICAgIGNvbnN0IGluaXRpYXRlZCA9IG5ldyBEYXRlKHVwbG9hZC5Jbml0aWF0ZWQpXG4gICAgICByZXN1bHQudXBsb2Fkcy5wdXNoKHsga2V5LCB1cGxvYWRJZCwgaW5pdGlhdG9yLCBvd25lciwgc3RvcmFnZUNsYXNzLCBpbml0aWF0ZWQgfSlcbiAgICB9KVxuICB9XG4gIHJldHVybiByZXN1bHRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlT2JqZWN0TG9ja0NvbmZpZyh4bWw6IHN0cmluZyk6IE9iamVjdExvY2tJbmZvIHtcbiAgY29uc3QgeG1sT2JqID0gcGFyc2VYbWwoeG1sKVxuICBsZXQgbG9ja0NvbmZpZ1Jlc3VsdCA9IHt9IGFzIE9iamVjdExvY2tJbmZvXG4gIGlmICh4bWxPYmouT2JqZWN0TG9ja0NvbmZpZ3VyYXRpb24pIHtcbiAgICBsb2NrQ29uZmlnUmVzdWx0ID0ge1xuICAgICAgb2JqZWN0TG9ja0VuYWJsZWQ6IHhtbE9iai5PYmplY3RMb2NrQ29uZmlndXJhdGlvbi5PYmplY3RMb2NrRW5hYmxlZCxcbiAgICB9IGFzIE9iamVjdExvY2tJbmZvXG4gICAgbGV0IHJldGVudGlvblJlc3BcbiAgICBpZiAoXG4gICAgICB4bWxPYmouT2JqZWN0TG9ja0NvbmZpZ3VyYXRpb24gJiZcbiAgICAgIHhtbE9iai5PYmplY3RMb2NrQ29uZmlndXJhdGlvbi5SdWxlICYmXG4gICAgICB4bWxPYmouT2JqZWN0TG9ja0NvbmZpZ3VyYXRpb24uUnVsZS5EZWZhdWx0UmV0ZW50aW9uXG4gICAgKSB7XG4gICAgICByZXRlbnRpb25SZXNwID0geG1sT2JqLk9iamVjdExvY2tDb25maWd1cmF0aW9uLlJ1bGUuRGVmYXVsdFJldGVudGlvbiB8fCB7fVxuICAgICAgbG9ja0NvbmZpZ1Jlc3VsdC5tb2RlID0gcmV0ZW50aW9uUmVzcC5Nb2RlXG4gICAgfVxuICAgIGlmIChyZXRlbnRpb25SZXNwKSB7XG4gICAgICBjb25zdCBpc1VuaXRZZWFycyA9IHJldGVudGlvblJlc3AuWWVhcnNcbiAgICAgIGlmIChpc1VuaXRZZWFycykge1xuICAgICAgICBsb2NrQ29uZmlnUmVzdWx0LnZhbGlkaXR5ID0gaXNVbml0WWVhcnNcbiAgICAgICAgbG9ja0NvbmZpZ1Jlc3VsdC51bml0ID0gUkVURU5USU9OX1ZBTElESVRZX1VOSVRTLllFQVJTXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBsb2NrQ29uZmlnUmVzdWx0LnZhbGlkaXR5ID0gcmV0ZW50aW9uUmVzcC5EYXlzXG4gICAgICAgIGxvY2tDb25maWdSZXN1bHQudW5pdCA9IFJFVEVOVElPTl9WQUxJRElUWV9VTklUUy5EQVlTXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGxvY2tDb25maWdSZXN1bHRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlQnVja2V0VmVyc2lvbmluZ0NvbmZpZyh4bWw6IHN0cmluZykge1xuICBjb25zdCB4bWxPYmogPSBwYXJzZVhtbCh4bWwpXG4gIHJldHVybiB4bWxPYmouVmVyc2lvbmluZ0NvbmZpZ3VyYXRpb25cbn1cbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUVBLElBQUFBLGNBQUEsR0FBQUMsT0FBQTtBQUVBLElBQUFDLE1BQUEsR0FBQUMsdUJBQUEsQ0FBQUYsT0FBQTtBQUNBLElBQUFHLE9BQUEsR0FBQUgsT0FBQTtBQUNBLElBQUFJLFNBQUEsR0FBQUosT0FBQTtBQUVBLElBQUFLLEtBQUEsR0FBQUwsT0FBQTtBQUFvRCxTQUFBTSx5QkFBQUMsV0FBQSxlQUFBQyxPQUFBLGtDQUFBQyxpQkFBQSxPQUFBRCxPQUFBLFFBQUFFLGdCQUFBLE9BQUFGLE9BQUEsWUFBQUYsd0JBQUEsWUFBQUEsQ0FBQUMsV0FBQSxXQUFBQSxXQUFBLEdBQUFHLGdCQUFBLEdBQUFELGlCQUFBLEtBQUFGLFdBQUE7QUFBQSxTQUFBTCx3QkFBQVMsR0FBQSxFQUFBSixXQUFBLFNBQUFBLFdBQUEsSUFBQUksR0FBQSxJQUFBQSxHQUFBLENBQUFDLFVBQUEsV0FBQUQsR0FBQSxRQUFBQSxHQUFBLG9CQUFBQSxHQUFBLHdCQUFBQSxHQUFBLDRCQUFBRSxPQUFBLEVBQUFGLEdBQUEsVUFBQUcsS0FBQSxHQUFBUix3QkFBQSxDQUFBQyxXQUFBLE9BQUFPLEtBQUEsSUFBQUEsS0FBQSxDQUFBQyxHQUFBLENBQUFKLEdBQUEsWUFBQUcsS0FBQSxDQUFBRSxHQUFBLENBQUFMLEdBQUEsU0FBQU0sTUFBQSxXQUFBQyxxQkFBQSxHQUFBQyxNQUFBLENBQUFDLGNBQUEsSUFBQUQsTUFBQSxDQUFBRSx3QkFBQSxXQUFBQyxHQUFBLElBQUFYLEdBQUEsUUFBQVcsR0FBQSxrQkFBQUgsTUFBQSxDQUFBSSxTQUFBLENBQUFDLGNBQUEsQ0FBQUMs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