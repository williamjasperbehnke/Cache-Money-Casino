const resetLocalTables = () => {
  if (globalThis.__casinoLocalTables) {
    globalThis.__casinoLocalTables.clear();
  } else {
    globalThis.__casinoLocalTables = new Map();
  }
};

const makeEvent = ({
  method = "GET",
  path = "/",
  body,
  headers,
  pathParameters,
  queryStringParameters,
  requestContext,
} = {}) => ({
  requestContext: {
    http: { method, path },
    ...requestContext,
  },
  httpMethod: method,
  path,
  rawPath: path,
  headers: headers || {},
  pathParameters,
  queryStringParameters,
  body: body ? JSON.stringify(body) : undefined,
});

const parseResponse = (resp) => ({
  statusCode: resp.statusCode,
  headers: resp.headers,
  body: resp.body ? JSON.parse(resp.body) : null,
});

const makeWsEvent = ({
  connectionId = "conn-1",
  domainName = "example.com",
  stage = "dev",
  body,
} = {}) => ({
  requestContext: { connectionId, domainName, stage },
  body: body ? JSON.stringify(body) : undefined,
});

module.exports = {
  resetLocalTables,
  makeEvent,
  parseResponse,
  makeWsEvent,
};
