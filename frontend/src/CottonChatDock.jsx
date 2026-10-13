import { useState, useSyncExternalStore } from 'react';
import CottonPet from './CottonPet.jsx';
import { petLocalStorage, petStorageKey } from './cotton/pet-state.js';
import { isPetDockObscured, readPetDockEnabled, savePetDockEnabled, subscribePetDockEnvironment } from './cotton/dock-environment.js';

function Dock({ accountScope, companionScope, storageKey, blocked, onOpenHouse }) {
  const [enabled, setEnabled] = useState(() => readPetDockEnabled(petLocalStorage(), storageKey));
  const obscured = useSyncExternalStore(subscribePetDockEnvironment, isPetDockObscured, () => false);
  const visible = enabled && !blocked && !obscured;
  return <section className="cotton-chat-dock" aria-label="聊天小窝">
    <div className="cotton-dock-bar">
      <button type="button" aria-pressed={enabled} aria-expanded={visible} onClick={() => {
        const next = !enabled;
        setEnabled(next);
        savePetDockEnabled(petLocalStorage(), storageKey, next);
      }}>{enabled ? '收起小棉花' : '✿ 请小棉花来陪聊'}</button>
      {enabled && <span>{visible ? '安静待在你身边' : '暂时收起，空闲时回来'}</span>}
      {visible && onOpenHouse && <button type="button" onClick={onOpenHouse}>去小屋 ↗</button>}
    </div>
    {visible && <CottonPet accountScope={accountScope} companionScope={companionScope} compact />}
  </section>;
}

export default function CottonChatDock({ accountScope = '', companionScope = '', blocked = false, onOpenHouse }) {
  const storageKey = petStorageKey(accountScope, companionScope);
  return <Dock key={storageKey || 'guest'} {...{accountScope, companionScope, storageKey, blocked, onOpenHouse}} />;
}
