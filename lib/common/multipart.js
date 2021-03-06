

const callback = require('./callback');

const proto = exports;


/**
 * List the on-going multipart uploads
 * https://help.aliyun.com/document_detail/31997.html
 * @param {Object} options
 * @return {Array} the multipart uploads
 */
proto.listUploads = function* listUploads(query, options) {
  options = options || {};
  options.subres = 'uploads';
  const params = this._objectRequestParams('GET', '', options);
  params.query = query;
  params.xmlResponse = true;
  params.successStatuses = [200];

  const result = yield this.request(params);
  let uploads = result.data.Upload || [];
  if (!Array.isArray(uploads)) {
    uploads = [uploads];
  }
  uploads = uploads.map(up => ({
    name: up.Key,
    uploadId: up.UploadId,
    initiated: up.Initiated,
  }));

  return {
    res: result.res,
    uploads,
    bucket: result.data.Bucket,
    nextKeyMarker: result.data.NextKeyMarker,
    nextUploadIdMarker: result.data.NextUploadIdMarker,
    isTruncated: result.data.IsTruncated === 'true',
  };
};

/**
 * List the done uploadPart parts
 * @param {String} name object name
 * @param {String} uploadId multipart upload id
 * @param {Object} query
 * {Number} query.max-parts The maximum part number in the response of the OSS. Default value: 1000
 * {Number} query.part-number-marker Starting position of a specific list.
 * {String} query.encoding-type Specify the encoding of the returned content and the encoding type.
 * @param {Object} options
 * @return {Object} result
 */
proto.listParts = function* listParts(name, uploadId, query, options) {
  options = options || {};
  options.subres = {
    uploadId,
  };
  const params = this._objectRequestParams('GET', name, options);
  params.query = query;
  params.xmlResponse = true;
  params.successStatuses = [200];

  const result = yield this.request(params);

  return {
    res: result.res,
    uploadId: result.data.UploadId,
    bucket: result.data.Bucket,
    name: result.data.Key,
    partNumberMarker: result.data.PartNumberMarker,
    nextPartNumberMarker: result.data.NextPartNumberMarker,
    maxParts: result.data.MaxParts,
    isTruncated: result.data.IsTruncated,
    parts: result.data.Part || [],
  };
};

/**
 * Abort a multipart upload transaction
 * @param {String} name the object name
 * @param {String} uploadId the upload id
 * @param {Object} options
 */
proto.abortMultipartUpload = function* abortMultipartUpload(name, uploadId, options) {
  this.cancel();
  options = options || {};
  options.subres = { uploadId };
  const params = this._objectRequestParams('DELETE', name, options);
  params.successStatuses = [204];

  const result = yield this.request(params);
  return {
    res: result.res,
  };
};

/**
 * Initiate a multipart upload transaction
 * @param {String} name the object name
 * @param {Object} options
 * @return {String} upload id
 */
proto.initMultipartUpload = function* initMultipartUpload(name, options) {
  options = options || {};
  options.headers = options.headers || {};
  this._convertMetaToHeaders(options.meta, options.headers);

  options.subres = 'uploads';
  const params = this._objectRequestParams('POST', name, options);
  params.mime = options.mime;
  params.xmlResponse = true;
  params.successStatuses = [200];

  const result = yield this.request(params);

  return {
    res: result.res,
    bucket: result.data.Bucket,
    name: result.data.Key,
    uploadId: result.data.UploadId,
  };
};

/**
 * Upload a part in a multipart upload transaction
 * @param {String} name the object name
 * @param {String} uploadId the upload id
 * @param {Integer} partNo the part number
 * @param {File} file upload File, whole File
 * @param {Integer} start  part start bytes  e.g: 102400
 * @param {Integer} end  part end bytes  e.g: 204800
 * @param {Object} options
 */
proto.uploadPart = function* uploadPart(name, uploadId, partNo, file, start, end, options) {
  const data = {
    stream: this._createStream(file, start, end),
    size: end - start,
  };
  return yield this._uploadPart(name, uploadId, partNo, data, options);
};

/**
 * Complete a multipart upload transaction
 * @param {String} name the object name
 * @param {String} uploadId the upload id
 * @param {Array} parts the uploaded parts, each in the structure:
 *        {Integer} number partNo
 *        {String} etag  part etag  uploadPartCopy result.res.header.etag
 * @param {Object} options
 *         {Object} options.callback The callback parameter is composed of a JSON string encoded in Base64
 *         {String} options.callback.url  the OSS sends a callback request to this URL
 *         {String} options.callback.host  The host header value for initiating callback requests
 *         {String} options.callback.body  The value of the request body when a callback is initiated
 *         {String} options.callback.contentType  The Content-Type of the callback requests initiatiated
 *         {Object} options.callback.customValue  Custom parameters are a map of key-values, e.g:
 *                   customValue = {
 *                     key1: 'value1',
 *                     key2: 'value2'
 *                   }
 */
proto.completeMultipartUpload = function* completeMultipartUpload(name, uploadId, parts, options) {
  const completeParts = parts.concat().sort((a, b) => a.number - b.number)
    .filter((item, index, arr) => !index || item.number !== arr[index - 1].number);
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<CompleteMultipartUpload>\n';
  for (let i = 0; i < completeParts.length; i++) {
    const p = completeParts[i];
    xml += '<Part>\n';
    xml += `<PartNumber>${p.number}</PartNumber>\n`;
    xml += `<ETag>${p.etag}</ETag>\n`;
    xml += '</Part>\n';
  }
  xml += '</CompleteMultipartUpload>';

  options = options || {};
  options.subres = { uploadId };
  const params = this._objectRequestParams('POST', name, options);
  params.mime = 'xml';
  params.content = xml;

  callback.encodeCallback(options);

  if (!(options.headers && options.headers['x-oss-callback'])) {
    params.xmlResponse = true;
  }
  params.successStatuses = [200];
  const result = yield this.request(params);

  const ret = {
    res: result.res,
    bucket: params.bucket,
    name,
    etag: result.res.headers.etag,
  };

  if (options.headers && options.headers['x-oss-callback']) {
    ret.data = JSON.parse(result.data.toString());
  }

  return ret;
};

/**
 * Upload a part in a multipart upload transaction
 * @param {String} name the object name
 * @param {String} uploadId the upload id
 * @param {Integer} partNo the part number
 * @param {Object} data the body data
 * @param {Object} options
 */
proto._uploadPart = function* _uploadPart(name, uploadId, partNo, data, options) {
  options = options || {};
  options.headers = {
    'Content-Length': data.size,
  };

  options.subres = {
    partNumber: partNo,
    uploadId,
  };
  const params = this._objectRequestParams('PUT', name, options);
  params.mime = options.mime;
  params.stream = data.stream;
  params.successStatuses = [200];

  const result = yield this.request(params);

  data.stream = null;
  params.stream = null;
  return {
    name,
    etag: result.res.headers.etag,
    res: result.res,
  };
};
