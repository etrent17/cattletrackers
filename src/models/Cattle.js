export class Cattle {
  constructor(data) {
    this.id = data.id || Date.now().toString();
    this.tagNumber = data.tagNumber || data.cowNumber || "";
    this.nameBreed = data.nameBreed || "";
    this.gender = data.gender || ""; // "" = not recorded; never guess
    this.birthDate = data.birthDate || null;
    this.lastCalvingDate = data.lastCalvingDate || null;
    this.expectedCalvingDate = data.expectedCalvingDate || null;
    this.medications = data.medications || "";
    this.withdrawalUntil = data.withdrawalUntil || ""; // read-only, follows the treatments
    this.weight = data.weight || null;
    this.healthStatus = this.normalizeStatus(data.healthStatus);
    this.notes = data.notes || "";
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();
  }

  normalizeStatus(status) {
    if (!status) return "healthy";
    if (status === "needs-attention") return "under_treatment";
    if (status === "sick") return "quarantine";
    return status;
  }

  update(data) {
    if (data.tagNumber !== undefined) this.tagNumber = data.tagNumber;
    if (data.nameBreed !== undefined) this.nameBreed = data.nameBreed;
    if (data.gender !== undefined) this.gender = data.gender;
    if (data.birthDate !== undefined) this.birthDate = data.birthDate;
    if (data.lastCalvingDate !== undefined) this.lastCalvingDate = data.lastCalvingDate;
    if (data.expectedCalvingDate !== undefined) this.expectedCalvingDate = data.expectedCalvingDate;
    if (data.medications !== undefined) this.medications = data.medications;
    if (data.withdrawalUntil !== undefined) this.withdrawalUntil = data.withdrawalUntil;
    if (data.weight !== undefined) this.weight = data.weight;
    if (data.healthStatus !== undefined) this.healthStatus = this.normalizeStatus(data.healthStatus);
    if (data.notes !== undefined) this.notes = data.notes;
    this.updatedAt = new Date().toISOString();
  }

  toJSON() {
    return {
      id: this.id,
      tagNumber: this.tagNumber,
      nameBreed: this.nameBreed,
      gender: this.gender,
      birthDate: this.birthDate,
      lastCalvingDate: this.lastCalvingDate,
      expectedCalvingDate: this.expectedCalvingDate,
      medications: this.medications,
      withdrawalUntil: this.withdrawalUntil,
      weight: this.weight,
      healthStatus: this.healthStatus,
      notes: this.notes,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  static fromJSON(json) {
    return new Cattle(json);
  }
}