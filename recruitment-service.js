import { db, storage } from "./firebase-config.js";
import {
    collection, doc, addDoc, updateDoc, getDocs, getDoc, setDoc,
    serverTimestamp, query, orderBy, onSnapshot
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-storage.js";

export const STAGES = ["Applied", "Screening", "Interview", "Offer", "Hired", "Rejected"];
export const INTERVIEW_ROUNDS = ["Phone Screen", "Technical", "HR", "Final"];

export function subscribeCandidates(callback, onError) {
    const q = query(collection(db, "candidates"), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) => {
        const candidates = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((c) => c.status !== "archived");
        callback(candidates);
    }, (err) => {
        console.warn("[RECRUITMENT] Snapshot error, falling back:", err);
        loadCandidates().then(callback).catch(onError || console.error);
    });
}

export async function loadCandidates() {
    const snap = await getDocs(query(collection(db, "candidates"), orderBy("createdAt", "desc")));
    return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((c) => c.status !== "archived");
}

export async function addCandidate(data) {
    const payload = {
        name: data.name,
        role: data.role,
        email: data.email || "",
        phone: data.phone || "",
        source: data.source || "Direct",
        department: data.department || "",
        expectedCtc: data.expectedCtc || "",
        notes: data.notes || "",
        stage: data.stage || "Applied",
        status: "active",
        stageHistory: [{ stage: data.stage || "Applied", at: new Date().toISOString(), by: "HR" }],
        offer: null,
        linkedUserId: null,
        onboardingStatus: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    };
    const refDoc = await addDoc(collection(db, "candidates"), payload);
    return refDoc.id;
}

export async function updateCandidate(id, patch, options = {}) {
    const existing = (await getDoc(doc(db, "candidates", id))).data() || {};
    const updates = { ...patch, updatedAt: serverTimestamp() };

    if (patch.stage && patch.stage !== existing.stage) {
        const history = existing.stageHistory || [];
        updates.stageHistory = [
            ...history,
            { stage: patch.stage, at: new Date().toISOString(), by: options.by || "HR" }
        ];
    }

    await updateDoc(doc(db, "candidates", id), updates);
}

export async function deleteCandidate(id) {
    await updateDoc(doc(db, "candidates", id), {
        status: "archived",
        archivedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    });
}

export async function uploadResume(candidateId, file) {
    const ext = file.name.split(".").pop() || "pdf";
    const storagePath = `recruitment/resumes/${candidateId}.${ext}`;
    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, file);
    const resumeUrl = await getDownloadURL(storageRef);
    await updateDoc(doc(db, "candidates", candidateId), {
        resumeUrl,
        resumeFileName: file.name,
        updatedAt: serverTimestamp()
    });
    return { resumeUrl, resumeFileName: file.name };
}

export async function getInterviews(candidateId) {
    const snap = await getDocs(collection(db, "candidates", candidateId, "interviews"));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function addInterview(candidateId, interviewData) {
    const payload = {
        round: interviewData.round || "Phone Screen",
        scheduledAt: interviewData.scheduledAt || null,
        interviewer: interviewData.interviewer || "",
        locationOrLink: interviewData.locationOrLink || "",
        status: interviewData.status || "Scheduled",
        feedback: interviewData.feedback || "",
        rating: interviewData.rating || null,
        createdAt: serverTimestamp()
    };
    const interviewRef = await addDoc(collection(db, "candidates", candidateId, "interviews"), payload);

    if (payload.scheduledAt) {
        await addDoc(collection(db, "recruitment_events"), {
            candidateId,
            interviewId: interviewRef.id,
            type: "interview",
            title: `${payload.round} — ${interviewData.candidateName || "Candidate"}`,
            scheduledAt: payload.scheduledAt,
            interviewer: payload.interviewer,
            locationOrLink: payload.locationOrLink,
            createdAt: serverTimestamp()
        });
    }

    return interviewRef.id;
}

export async function updateOffer(candidateId, offerData) {
    await updateDoc(doc(db, "candidates", candidateId), {
        offer: {
            ctc: offerData.ctc || "",
            joiningDate: offerData.joiningDate || "",
            status: offerData.status || "Draft",
            sentAt: offerData.sentAt || null
        },
        updatedAt: serverTimestamp()
    });
}

export async function startOnboarding(candidateId) {
    const candSnap = await getDoc(doc(db, "candidates", candidateId));
    if (!candSnap.exists()) throw new Error("Candidate not found");
    const c = candSnap.data();

    const onboardingToken = `HRFLOW-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    const expiryDate = new Date();
    expiryDate.setHours(expiryDate.getHours() + 3);
    const empId = `emp_${Math.random().toString(36).substr(2, 9)}`;

    const empData = {
        fullName: c.name,
        name: c.name,
        email: (c.email || "").toLowerCase(),
        phoneNumber: c.phone || "",
        designation: c.role,
        department: c.department || "General",
        employmentType: "Full-time",
        status: "Invitation Sent",
        onboardingStatus: "Invitation Sent",
        onboardingToken,
        onboardingTokenExpiry: expiryDate,
        role: "employee",
        hiredFromCandidateId: candidateId,
        createdAt: serverTimestamp()
    };

    await setDoc(doc(db, "users", empId), empData);
    await updateCandidate(candidateId, {
        stage: "Hired",
        linkedUserId: empId,
        onboardingStatus: "invited"
    }, { by: "Onboarding" });

    const inviteLink = `${window.location.origin}/onboarding-invite.html?token=${onboardingToken}&id=${empId}`;
    return { empId, inviteLink, onboardingToken };
}

export function filterCandidates(candidates, filters = {}) {
    const term = (filters.search || "").toLowerCase().trim();
    return candidates.filter((c) => {
        if (filters.stage && filters.stage !== "all" && c.stage !== filters.stage) return false;
        if (filters.source && filters.source !== "all" && c.source !== filters.source) return false;
        if (!term) return true;
        return [c.name, c.role, c.email, c.department, c.source]
            .some((v) => (v || "").toLowerCase().includes(term));
    });
}

export async function getUpcomingInterviews(days = 7) {
    const candidates = await loadCandidates();
    const upcoming = [];
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + days);

    for (const c of candidates) {
        const interviews = await getInterviews(c.id);
        interviews.forEach((iv) => {
            if (!iv.scheduledAt || iv.status === "Cancelled") return;
            const dt = iv.scheduledAt.toDate ? iv.scheduledAt.toDate() : new Date(iv.scheduledAt);
            if (dt >= new Date() && dt <= cutoff) {
                upcoming.push({ ...iv, candidateId: c.id, candidateName: c.name, candidateRole: c.role, scheduledDate: dt });
            }
        });
    }

    return upcoming.sort((a, b) => a.scheduledDate - b.scheduledDate);
}
