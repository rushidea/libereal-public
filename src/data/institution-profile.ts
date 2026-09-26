export type InstitutionLabels = {
  name: string;
  unit: string;
  department: string;
  facility: string;
};

export type InstitutionProfileInput = {
  institutionType: string;
  institutionName: string;
  institutionUnit: string;
  department: string;
  institutionFacility: string;
  piLab: string;
  affiliatedLab?: string | null;
};

export function getInstitutionLabels(institutionType: string | null | undefined): InstitutionLabels {
  const type = institutionType?.trim() ?? '';

  if (/医院|医疗|诊所|卫生/.test(type)) {
    return { name: '医院', unit: '院区', department: '科室', facility: '病区、实验室或研究中心' };
  }

  if (/科研|研究所|研究院|科学院/.test(type)) {
    return { name: '科研院所', unit: '研究所或中心', department: '部门', facility: '课题组或实验室' };
  }

  if (/高校|学校|大学|学院/.test(type)) {
    return { name: '学校', unit: '学院', department: '学系或部门', facility: '楼号' };
  }

  return { name: '机构', unit: '组织单元', department: '部门', facility: '具体单元' };
}

export function isSchoolInstitutionType(institutionType: string | null | undefined): boolean {
  return /高校|学校|大学|学院/.test(institutionType?.trim() ?? '');
}

export function buildLegacyInstitution(profile: InstitutionProfileInput): string {
  return [
    profile.institutionName,
    profile.institutionUnit,
    profile.department,
    profile.institutionFacility,
    profile.piLab,
  ].map(value => value.trim()).filter(Boolean).join('-');
}

export function buildLegacySchoolFields(profile: InstitutionProfileInput): {
  school: string | null;
  college: string | null;
  major: string | null;
  building: string | null;
} {
  if (!isSchoolInstitutionType(profile.institutionType)) {
    return { school: null, college: null, major: null, building: null };
  }

  return {
    school: profile.institutionName.trim() || null,
    college: profile.institutionUnit.trim() || null,
    major: profile.department.trim() || null,
    building: profile.institutionFacility.trim() || null,
  };
}
