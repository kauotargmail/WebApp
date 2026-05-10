// components/DualMultiSelect.jsx
import React from 'react';

const DualMultiSelect = ({ leftItems, rightItems, onTransfer, leftTitle, rightTitle, getItemId, getItemLabel }) => {
    const [selectedLeft, setSelectedLeft] = React.useState([]);
    const [selectedRight, setSelectedRight] = React.useState([]);

    const moveToRight = () => {
        if (selectedLeft.length === 0) return;
        const itemsToMove = leftItems.filter(item => selectedLeft.includes(getItemId(item)));
        onTransfer(itemsToMove, 'right');
        setSelectedLeft([]);
    };

    const moveToLeft = () => {
        if (selectedRight.length === 0) return;
        const itemsToMove = rightItems.filter(item => selectedRight.includes(getItemId(item)));
        onTransfer(itemsToMove, 'left');
        setSelectedRight([]);
    };

    const renderList = (items, selected, setSelected, title) => (
        <div style={{ flex: 1, border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
            <div style={{ background: '#f7fafc', padding: '8px', fontWeight: 'bold', borderBottom: '1px solid #e2e8f0' }}>{title}</div>
            <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                {items.map(item => {
                    const id = getItemId(item);
                    return (
                        <div key={id} style={{ padding: '8px', borderBottom: '1px solid #edf2f7', cursor: 'pointer', background: selected.includes(id) ? '#e2e8f0' : 'white' }} onClick={() => setSelected(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id])}>
                            {getItemLabel(item)}
                        </div>
                    );
                })}
                {items.length === 0 && <div style={{ padding: '8px', color: '#a0aec0' }}>No items</div>}
            </div>
        </div>
    );

    return (
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            {renderList(leftItems, selectedLeft, setSelectedLeft, leftTitle)}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button onClick={moveToRight} style={{ padding: '8px 12px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>→</button>
                <button onClick={moveToLeft} style={{ padding: '8px 12px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>←</button>
            </div>
            {renderList(rightItems, selectedRight, setSelectedRight, rightTitle)}
        </div>
    );
};

export default DualMultiSelect;