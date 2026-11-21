export class FormView {
  constructor() {
    this.modalEl = document.getElementById("addCowModal");
    this.modalInstance = this.modalEl ? new bootstrap.Modal(this.modalEl) : null;
    this.form = document.getElementById("cattle-form");
  }

  openModal(isEditing = false) {
    this.updateFormUI(isEditing);
    this.modalInstance?.show();
  }

  closeModal() {
    this.modalInstance?.hide();
  }

  getFormData() {
    return {
      tagNumber: document.getElementById("cow-number").value.trim(),
      nameBreed: document.getElementById("name-breed").value.trim(),
      gender: document.getElementById("gender").value,
      birthDate: document.getElementById("birth-date").value,
      weight: document.getElementById("weight").value,
      lastCalvingDate: document.getElementById("last-calving-date").value,
      expectedCalvingDate: document.getElementById("expected-calving-date").value,
      medications: document.getElementById("medications").value.trim(),
      healthStatus: document.getElementById("health-status").value,
      notes: document.getElementById("notes").value.trim(),
    };
  }

  populateForm(cattle) {
    document.getElementById("cow-number").value = cattle.tagNumber || "";
    document.getElementById("name-breed").value = cattle.nameBreed || "";
    document.getElementById("gender").value = cattle.gender || "female";
    document.getElementById("birth-date").value = cattle.birthDate || "";
    document.getElementById("weight").value = cattle.weight || "";
    document.getElementById("last-calving-date").value = cattle.lastCalvingDate || "";
    document.getElementById("expected-calving-date").value = cattle.expectedCalvingDate || "";
    document.getElementById("medications").value = cattle.medications || "";
    document.getElementById("health-status").value = cattle.healthStatus || "healthy";
    document.getElementById("notes").value = cattle.notes || "";
  }

  resetForm() {
    this.form?.reset();
  }

  updateFormUI(isEditing) {
    const titleEl = document.getElementById("addCowModalLabel");
    const saveBtn = document.getElementById("save-cattle-btn");
    if (titleEl) {
      titleEl.innerHTML = isEditing
        ? `<i class="fas fa-edit me-2 text-success"></i>Edit Cattle Record`
        : `<i class="fas fa-cow me-2 text-success"></i>Add New Cattle Record`;
    }
    if (saveBtn) {
      saveBtn.textContent = isEditing ? "Update Record" : "Save Record";
    }
  }
}