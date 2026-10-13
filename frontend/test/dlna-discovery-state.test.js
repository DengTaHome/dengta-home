import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeDlnaState } from '../src/dlna-receiver.js';

test('bound ports and joined multicast are required before native discovery is active',()=>{
  for(const [ssdpReady,httpReady] of [[false,false],[true,false],[false,true]]) {
    const state=normalizeDlnaState({supported:true,enabled:true,active:true,ssdpReady,httpReady,discoveryStatus:'starting'});
    assert.equal(state.active,false);
    assert.equal(state.enabled,true);
    assert.equal(state.discoveryStatus,'starting');
  }
  assert.equal(normalizeDlnaState({supported:true,enabled:true,active:true,ssdpReady:true,httpReady:true,discoveryStatus:'ready'}).active,true);
});

test('native discovery errors remain precise, and unknown SSID is not presented as a Wi-Fi name',()=>{
  for(const errorCode of ['dlna_ssdp_bind_failed','dlna_multicast_join_failed','dlna_http_bind_failed']) {
    const state=normalizeDlnaState({supported:true,enabled:true,active:true,ssdpReady:true,httpReady:true,discoveryStatus:'error',errorCode,wifiName:'<unknown ssid>'});
    assert.equal(state.active,false);assert.equal(state.errorCode,errorCode);assert.equal(state.wifiName,'');
  }
  assert.equal(normalizeDlnaState({active:true,wifiName:'Synthetic WiFi'}).active,true,'older native receipts preserve their original active contract');
});
