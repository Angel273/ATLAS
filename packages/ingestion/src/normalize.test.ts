import { describe,it,expect } from 'vitest';
import { normalize } from './normalize.js';
import type { Regional } from '@atlas/contracts';
const regional: Regional = {decimalSeparator:',',thousandsSeparator:'.',dateFormat:'DD/MM/YYYY',timezone:'America/Guatemala',delimiter:';'};
describe('regional values without guessing',()=>{
  it('preserves precision and validates grouping',()=>{
    expect(normalize('9.007.199.254.740.993,123456789012','decimal',regional,false)).toBe('9007199254740993.123456789012');
    expect(()=>normalize('12.34,56','decimal',regional,false)).toThrow();
    expect(()=>normalize('0,1234567890123','decimal',regional,false)).toThrow();
    expect(normalize('','decimal',regional,false)).toBeNull();
    expect(()=>normalize('','string',regional,true)).toThrow('REQUIRED_VALUE');
  });
  it('uses explicit date order and rejects impossible and ambiguous wall times',()=>{
    expect(normalize('03/04/2026','date',regional,false)).toBe('2026-04-03');
    expect(normalize('03/04/2026','date',{...regional,dateFormat:'MM/DD/YYYY'},false)).toBe('2026-03-04');
    expect(()=>normalize('31/02/2026','date',regional,false)).toThrow();
    expect(()=>normalize('2026-11-01T01:30:00','datetime',{...regional,dateFormat:'YYYY-MM-DD',timezone:'America/New_York'},false)).toThrow();
  });
});
