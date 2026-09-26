import { describe, expect, it } from 'vitest';
import {
  buildLegacyInstitution,
  buildLegacySchoolFields,
  getInstitutionLabels,
} from '@/data/institution-profile';

describe('institution profile mapping', () => {
  it('uses the school hierarchy labels', () => {
    expect(getInstitutionLabels('高校')).toEqual({
      name: '学校',
      unit: '学院',
      department: '学系或部门',
      facility: '楼号',
    });
  });

  it('uses hospital and research institute hierarchy labels', () => {
    expect(getInstitutionLabels('医院').unit).toBe('院区');
    expect(getInstitutionLabels('科研院所').facility).toBe('课题组或实验室');
  });

  it('keeps generic institution types available', () => {
    const profile = {
      institutionType: '企业研发中心',
      institutionName: '某企业',
      institutionUnit: '研发中心',
      department: '分析部门',
      institutionFacility: '实验平台',
      piLab: '王老师课题组',
    };
    expect(buildLegacyInstitution(profile)).toBe('某企业-研发中心-分析部门-实验平台-王老师课题组');
    expect(buildLegacySchoolFields(profile)).toEqual({ school: null, college: null, major: null, building: null });
  });
});
