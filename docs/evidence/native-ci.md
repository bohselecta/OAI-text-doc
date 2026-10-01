# Native browser CI

Observed successful native Chromium navigation, HTTP, CSP loading and real downloads. All 15 browser behavior groups passed, with zero page errors and zero provider calls. Node 24 unit/integration tests and runtime packaging also passed in this run.

Run: https://github.com/bohselecta/OAI-text-doc/actions/runs/36795321575

Transport commit: 994c6e60f24e27d1af4e8f024a63cf8388d3738f

Base archive SHA-256: `85edf1526385374e6b7f6f4b9d3f9fb573d9e74bae75e298fb64dfa604c01fce`, followed by the reviewed CSP-polling test patch. Every runtime/test source hash was checked against the updated local verification manifest before execution. The first native attempt exposed string-based Playwright polling blocked by the application CSP; the polling helper was corrected without changing application policy or weakening assertions.

These checks do not establish live provider quality, host integration, production readiness or executed licensing.
