process.env.LOCAL_DEV = "true";

const {
  jsonResponse,
  parseJson,
  getAuthToken,
  createToken,
  isStrongPassword,
  hashPassword,
  verifyPassword,
  getRoute,
  sumValues,
  ttlFromNow,
} = require("../../lib/utils");

describe("utils", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("jsonResponse serializes body and sets CORS headers", () => {
    const resp = jsonResponse(200, { ok: true }, "https://example.com");
    expect(resp.statusCode).toBe(200);
    expect(resp.headers["Access-Control-Allow-Origin"]).toBe("https://example.com");
    expect(JSON.parse(resp.body)).toEqual({ ok: true });
  });

  it("parseJson handles empty and invalid bodies", () => {
    expect(parseJson({})).toEqual({});
    expect(parseJson({ body: "{" })).toEqual({});
    expect(parseJson({ body: "{\"a\":1}" })).toEqual({ a: 1 });
  });

  it("getAuthToken reads bearer token and handles missing", () => {
    expect(getAuthToken({ headers: { authorization: "Bearer abc" } })).toBe("abc");
    expect(getAuthToken({ headers: { Authorization: "Bearer def" } })).toBe("def");
    expect(getAuthToken({ headers: { authorization: "Token abc" } })).toBe("");
  });

  it("createToken returns 64-char hex", () => {
    const token = createToken();
    expect(token).toMatch(/^[a-f0-9]{64}$/);
  });

  it("isStrongPassword enforces complexity", () => {
    expect(isStrongPassword("short")).toBe(false);
    expect(isStrongPassword("NoNumber!" )).toBe(false);
    expect(isStrongPassword("NoSymbol1" )).toBe(false);
    expect(isStrongPassword("Good1!Aa" )).toBe(true);
  });

  it("hashPassword and verifyPassword roundtrip", () => {
    const { salt, hash } = hashPassword("Secret1!");
    expect(verifyPassword("Secret1!", salt, hash)).toBe(true);
    expect(verifyPassword("Wrong1!", salt, hash)).toBe(false);
  });

  it("getRoute handles http api and trims slashes", () => {
    const event = { requestContext: { http: { method: "GET", path: "/foo/bar/" } } };
    expect(getRoute(event)).toEqual({ method: "GET", path: "/foo/bar" });
  });

  it("sumValues totals numeric values", () => {
    expect(sumValues({ a: 1, b: "2", c: 0 })).toBe(3);
  });

  it("ttlFromNow uses epoch seconds", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    expect(ttlFromNow(30)).toBe(Math.floor(1_700_000_000_000 / 1000) + 30);
  });
});
