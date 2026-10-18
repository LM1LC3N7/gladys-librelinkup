# Third-party notices

Nothing but the Gladys SDK is installed at runtime. Parts of this
integration are a JavaScript port of the work below.

## pylibrelinkup

pylibrelinkup 0.11.2 (<https://github.com/robberwick/pylibrelinkup>, read
at the tag `v0.11.2`, commit `a21d307`), an unofficial Python client of the
LibreLinkUp API, under the MIT License. Ported to JavaScript in `src/llu/`:
the regional hosts of the API (`api_url.py`), the headers of the
LibreLinkUp app and its version, the login and its answers (a redirect to
the region of the account, the steps to complete in the app, a refusal),
the SHA-256 digest of the user id sent as `account-id`, the list of
connections (`pylibrelinkup.py`, `exceptions.py`), the shapes of the
answers and how the dates of the measurements are read (`models/`), and
the shapes of its models used with made-up values in `test/`.

```
MIT License

Copyright (c) 2024 Rob Berwick

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

FreeStyle Libre, LibreLinkUp and LibreView are trademarks of Abbott; this
integration is unofficial and not affiliated with Abbott.

## LM1LC3N7/gladys-invoxia

The structure of the app (start queue, epochs of the loop, stops kept as a
salted HMAC in `/data`, one forced attempt per series, bounded pauses kept
in `/data`, state budget, transport badges, never a smaller device, the
"once per threshold" trigger), the HTTP transport and the test helpers
follow this integration of the same author, under the Apache License 2.0
of this repository.
