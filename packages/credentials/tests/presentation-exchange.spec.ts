import type { PortableDid } from '@web5/dids';
import type { JwsHeaderParams } from '@web5/crypto';

import { expect } from 'chai';
import { Convert } from '@web5/common';
import { DidKeyMethod } from '@web5/dids';
import { Ed25519, Jose } from '@web5/crypto';

import type {
  PresentationResult,
  VerifiableCredentialV1,
  PresentationDefinition,
  JwtDecodedVerifiablePresentation,
} from '../src/types.js';

import { evaluateCredentials, evaluatePresentation, presentationFrom } from '../src/types.js';

/**
 * Local types used only in this test specification.
 */
type CreateJwtOpts = {
  header: JwtHeaderParams;
  payload: any;
  subject: string;
  issuer: string;
  signer: Signer;
}

type JwtHeaderParams = JwsHeaderParams & {
  alg: string;
  typ: 'JWT'
};

type Signer = (data: Uint8Array) => Promise<Uint8Array>;

describe('PresentationExchange', () => {
  describe('Full Presentation Exchange', () => {
    let alice: PortableDid;
    let header: JwtHeaderParams;
    let signer: Signer;
    let btcCredentialJwt: string;
    let presentationDefinition: PresentationDefinition;
    let presentationResult: PresentationResult;

    before(async () => {
      alice = await DidKeyMethod.create();

      const [ signingKeyPair ] = alice.keySet.verificationMethodKeys!;
      const { keyMaterial: privateKey } = await Jose.jwkToKey({ key: signingKeyPair.privateKeyJwk! });
      signer = EdDsaSigner(privateKey);

      header = { alg: 'EdDSA', typ: 'JWT', kid: signingKeyPair.privateKeyJwk!.kid };

      btcCredentialJwt = await createBtcCredentialJwt(alice.did, header, signer);
      presentationDefinition = createPresentationDefinition();
    });

    it('should evaluate credentials without any errors or warnings', async () => {
      const evaluationResults = evaluateCredentials(presentationDefinition, [btcCredentialJwt]);

      expect(evaluationResults.errors).to.be.an('array');
      expect(evaluationResults.errors?.length).to.equal(0);
      expect(evaluationResults.warnings).to.be.an('array');
      expect(evaluationResults.warnings?.length).to.equal(0);
    });

    it('should successfully create a presentation from the given definition and credentials', () => {
      presentationResult = presentationFrom(presentationDefinition, [btcCredentialJwt]);

      expect(presentationResult).to.exist;
      expect(presentationResult.presentationSubmission.definition_id).to.equal(presentationDefinition.id);
    });

    it('should evaluate the presentation without any errors or warnings', async () => {
      const vpJwt = await createJwt({
        header,
        issuer  : alice.did,
        payload : { vp: presentationResult.presentation },
        signer,
        subject : alice.did,
      });

      const presentation = decodeJwt(vpJwt).payload.vp;

      const { warnings, errors } = evaluatePresentation(presentationDefinition,  presentation );

      expect(errors).to.be.an('array');
      expect(errors?.length).to.equal(0);

      expect(warnings).to.be.an('array');
      expect(warnings?.length).to.equal(0);
    });

    it('should successfully execute the complete presentation exchange flow', async () => {
      const evaluationResults = evaluateCredentials(presentationDefinition, [btcCredentialJwt]);

      expect(evaluationResults.errors).to.be.an('array');
      expect(evaluationResults.errors?.length).to.equal(0);
      expect(evaluationResults.warnings).to.be.an('array');
      expect(evaluationResults.warnings?.length).to.equal(0);

      presentationResult = presentationFrom(presentationDefinition, [btcCredentialJwt]);

      expect(presentationResult).to.exist;
      expect(presentationResult.presentationSubmission.definition_id).to.equal(presentationDefinition.id);

      const vpJwt = await createJwt({
        header,
        issuer  : alice.did,
        payload : { vp: presentationResult.presentation },
        signer,
        subject : alice.did,
      });

      const presentation = decodeJwt(vpJwt).payload.vp;

      const { warnings, errors } = evaluatePresentation(presentationDefinition,  presentation );

      expect(errors).to.be.an('array');
      expect(errors?.length).to.equal(0);

      expect(warnings).to.be.an('array');
      expect(warnings?.length).to.equal(0);
    });
  });
});

async function createBtcCredentialJwt(aliceDid: string, header: JwtHeaderParams, signer: Signer) {
  const btcCredential: VerifiableCredentialV1 = {
    '@context'          : ['https://www.w3.org/2018/credentials/v1'],
    'id'                : 'btc-credential',
    'type'              : ['VerifiableCredential'],
    'issuer'            : aliceDid,
    'issuanceDate'      : new Date().toISOString(),
    'credentialSubject' : {
      'btcAddress': 'btcAddress123'
    }
  };

  return await createJwt({
    header,
    issuer  : aliceDid,
    payload : { vc: btcCredential },
    signer,
    subject : aliceDid,
  });
}

async function createJwt(options: CreateJwtOpts) {
  const { header, issuer, subject, payload, signer } = options;

  const jwtPayload = {
    iss : issuer,
    sub : subject,
    ...payload,
  };

  const encodedHeader = Convert.object(header).toBase64Url();
  const encodedPayload = Convert.object(jwtPayload).toBase64Url();
  const message = encodedHeader + '.' + encodedPayload;
  const messageBytes = Convert.string(message).toUint8Array();

  const signature = await signer(messageBytes);

  const encodedSignature = Convert.uint8Array(signature).toBase64Url();
  const jwt = message + '.' + encodedSignature;

  return jwt;
}

function createPresentationDefinition() {
  return {
    'id'                : 'test-pd-id',
    'name'              : 'simple PD',
    'purpose'           : 'pd for testing',
    'input_descriptors' : [
      {
        'id'          : 'whatever',
        'purpose'     : 'id for testing',
        'constraints' : {
          'fields': [
            {
              'path': [
                '$.credentialSubject.btcAddress',
              ]
            }
          ]
        }
      }
    ]
  };
}

function decodeJwt(jwt: string) {
  const [encodedHeader, encodedPayload, encodedSignature] = jwt.split('.');

  return {
    header    : Convert.base64Url(encodedHeader).toObject() as JwtHeaderParams,
    payload   : Convert.base64Url(encodedPayload).toObject() as JwtDecodedVerifiablePresentation,
    signature : encodedSignature
  };
}

function EdDsaSigner(privateKey: Uint8Array): Signer {
  return async (data: Uint8Array): Promise<Uint8Array> => {
    const signature = await Ed25519.sign({ data, key: privateKey});
    return signature;
  };
}