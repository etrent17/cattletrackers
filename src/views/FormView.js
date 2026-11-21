export class FormView {
  constructor() {
    this.modalEl = document.getElementById("cattleModal");
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
      tagNumber: document.getElementById("f-tag").value.trim(),
      nameBreed: document.getElementById("f-name").value.trim(),
      gender: document.getElementById("f-gender").value,
      birthDate: document.getElementById("f-birth").value,
      weight: document.getElementById("f-weight").value,
      lastCalvingDate: document.getElementById("f-last-calving").value,
      expectedCalvingDate: document.getElementById("f-expected-calving").value,
      medications: document.getElementById("f-meds").value.trim(),
      healthStatus: document.getElementById("f-status").value,
      notes: document.getElementById("f-notes").value.trim(),
    };
  }

  populateForm(cattle) {
    document.getElementById("f-tag").value = cattle.tagNumber || "";
    document.getElementById("f-name").value = cattle.nameBreed || "";
    document.getElementById("f-gender").value = cattle.gender || "";
    document.getElementById("f-birth").value = cattle.birthDate || "";
    document.getElementById("f-weight").value = cattle.weight ?? "";
    document.getElementById("f-last-calving").value = cattle.lastCalvingDate || "";
    document.getElementById("f-expected-calving").value = cattle.expectedCalvingDate || "";
    document.getElementById("f-meds").value = cattle.medications || "";
    document.getElementById("f-status").value = cattle.healthStatus || "healthy";
    document.getElementById("f-notes").value = cattle.notes || "";
  }

  resetForm() {
    this.form?.reset();
  }

  updateFormUI(isEditing) {
    const titleEl = document.getElementById("cattleModalTitle");
    const saveBtn = this.form?.querySelector('button[type="submit"]');
    if (titleEl) {
      titleEl.textContent = isEditing ? "Edit Cattle Record" : "Add New Cattle Record";
    }
    if (saveBtn) {
      saveBtn.textContent = isEditing ? "Update Record" : "Save Record";
    }
    // The last calving date follows the calving records: it can be typed for a new animal
    // (it becomes her first calving record) and is read-only afterwards.
    const lastCalving = document.getElementById("f-last-calving");
    const lastCalvingHelp = document.getElementById("f-last-calving-help");
    if (lastCalving) lastCalving.disabled = isEditing;
    if (lastCalvingHelp) {
      lastCalvingHelp.textContent = isEditing
        ? "Set by her calving records. Record or edit a calving to change it."
        : "Saved as her first calving record.";
    }
  }
}
