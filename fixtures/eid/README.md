# eID fixtures

Invented eID cards, in the shape BeIDConnect answers an `ID` request with (`result`, `Readers[]`
with the card files in base64). No real person's card is in here, and none may be added.

- `card-beidconnect-specimen.json`: the virtual specimen card from BeIDConnect's own source
  (`common/VirtualCard.cpp` in https://github.com/Fedict/fts-beidconnect): "Alice Bert Specimen
  eID 18-75", signed by BOSA's `eID TEST RRN` test certificate (RSA, SHA-256). Its signatures
  verify. It matches no patient in `fixtures/r4/`.
- `card-matching-patient-1.json`: a card made up for this app with the name, birth date, gender
  and national number of `Patient/patient-1`. It is signed with a throwaway key whose self-signed
  certificate says "Invented test signer - not the National Register"; the private key was
  deleted. Its signatures verify against that certificate, which is exactly why the app says that
  the certificate itself is not checked against the Belgian root.

The national number of `patient-1` (`58041200212`) is invented and has a deliberately wrong check
number, so it cannot be anybody's.
