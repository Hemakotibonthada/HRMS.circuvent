// GET /api/scim/v2/ServiceProviderConfig — what this SCIM server supports.
//
// Provisioning clients read this before their first sync and adapt to it.
// Declaring a capability that is not implemented is worse than declaring
// none: the client will use it, and the operation will fail every time.
//
// Unauthenticated by design (RFC 7644 §4): it advertises capabilities, not
// data, and a client needs to read it while being configured.

import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json(
    {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
      documentationUri: "https://github.com/Hemakotibonthada/HRMS.circuvent",
      patch: { supported: true },
      // Not implemented, so not advertised. A client told bulk works would
      // send bulk requests that fail.
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: {
        supported: true,
        // The parser handles single-attribute comparisons only, which is what
        // every provisioning client sends in practice. A compound filter
        // returns 501 rather than a confidently wrong result.
        maxResults: 200,
      },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        {
          type: "oauthbearertoken",
          name: "OAuth Bearer Token",
          description: "Authentication via a bearer token issued in the admin console",
          specUri: "https://www.rfc-editor.org/rfc/rfc6750",
          primary: true,
        },
      ],
      meta: { resourceType: "ServiceProviderConfig", location: "/api/scim/v2/ServiceProviderConfig" },
    },
    { headers: { "Content-Type": "application/scim+json" } }
  );
}
