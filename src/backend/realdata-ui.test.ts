import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import App,{WalletRiskNotice,WorkspaceView} from '../App';
import {SignIn} from './SignIn';
import {WorkspaceWallet} from './WorkspaceWallet';
import {DraftReviewClient} from './draft-review';
describe('real-data entry and account access',()=>{
 it('defaults to mainnet reads rather than simulated agreements',()=>{const html=renderToStaticMarkup(React.createElement(App));expect(html).toContain('ARC MAINNET');expect(html).toContain('Reading mainnet');expect(html).not.toContain('SIMULATION');expect(html).not.toContain('Acme');expect(html).not.toContain('Read-only mode · Transactions unavailable');expect(html).not.toContain('class="nv-safety" role="note"');expect(html).toContain('Read-only application · financial execution disabled');expect(html).toContain('wallet warning remains unresolved');});
 it('shows account connection while backend network is unavailable, with no signing button',()=>{const html=renderToStaticMarkup(React.createElement(SignIn,{api:new DraftReviewClient(),onSignedIn:()=>{},onInvalidated:()=>{},onBusy:()=>{}}));expect(html).toContain('Connect wallet (account access only)');expect(html).toContain('Workspace network unavailable');expect(html).not.toContain('Sign in (message only)');});
 it('never invents an expected chain when network is unknown',()=>{const html=renderToStaticMarkup(React.createElement(WorkspaceWallet,{network:null,disabled:false,onProvider:()=>{},onStatus:()=>{}}));expect(html).toContain('network unavailable');expect(html).not.toContain('5042002');expect(html).not.toContain('5042');});
 it('keeps essential wallet risk visible outside the expandable details',()=>{
  const html=renderToStaticMarkup(React.createElement(WalletRiskNotice));
  const warning='Wallet warning unresolved. If your wallet flags this site, stop. Do not bypass the warning.';
  expect(html).toContain('role="note"');expect(html).toContain('id="wallet-risk-notice"');
  expect(html.indexOf(warning)).toBeGreaterThan(-1);expect(html.indexOf(warning)).toBeLessThan(html.indexOf('<details'));
  expect(html).toContain('Wallet safety details</summary>');expect(html).not.toContain('<details open');
  expect(html).toContain('Connecting an account does not sign a message or authorize a transaction.');
 });
 it('describes the workspace with the warning before account-access controls',()=>{
  const html=renderToStaticMarkup(React.createElement(WorkspaceView));
  expect(html).toContain('aria-describedby="wallet-risk-notice"');expect(html).toContain('aria-label="Workspace"');expect(html.split('<main ').length-1).toBe(1);
  expect(html).toContain('Connect wallet (account access only)');
  expect(html.indexOf('Wallet warning unresolved.')).toBeLessThan(html.indexOf('Connect wallet (account access only)'));
  expect(html).toContain('Financial execution remains disabled.');
 });
});
