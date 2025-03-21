export const institutionApprovalEmail = (name, sector, rc_number, registered_address, link, logo, authorizerName) => {
    return `
        <p>Dear ${authorizerName},</p>
        <p>A new institution has been created and requires your approval:</p>
        <ul>
            <li><strong>Name:</strong> ${name}</li>
            <li><strong>Sector:</strong> ${sector}</li>
            <li><strong>RC Number:</strong> ${rc_number}</li>
            <li><strong>Registered Address:</strong> ${registered_address}</li>
            <li><strong>Website:</strong> <a href="${link}" target="_blank">${link}</a></li>
            ${logo ? `<li><strong>Logo:</strong> <br><img src="${logo}" width="200"/></li>` : ''}
        </ul>
        <p>Please review and approve this institution.</p>
        <p>Best Regards,</p>
        <p>Your Team</p>
    `;
};




export const institutionApprovalUpdateEmail = (name, sector, rc_number, registered_address, link, logo, authorizerName) => {
    return `
        <p>Dear ${authorizerName},</p>
        <p>An institution has been update and requires your approval:</p>
        <ul>
            <li><strong>Name:</strong> ${name}</li>
            <li><strong>Sector:</strong> ${sector}</li>
            <li><strong>RC Number:</strong> ${rc_number}</li>
            <li><strong>Registered Address:</strong> ${registered_address}</li>
            <li><strong>Website:</strong> <a href="${link}" target="_blank">${link}</a></li>
            ${logo ? `<li><strong>Logo:</strong> <br><img src="${logo}" width="200"/></li>` : ''}
        </ul>
        <p>Please review and approve this institution.</p>
        <p>Best Regards,</p>
        <p>Your Team</p>
    `;
};





export const institutionStatusEmail = (status, fullName, institutionName, reason = '') => {
    const subject = status === 'approved'
        ? 'Institution Request Has Been Approved'
        : 'Institution Request Has Been Rejected';

    const newStatus = status === 'approved' ? 'approved' : 'rejected';

    const emailBody = `
        <p>Dear ${fullName},</p>
        <p>Your institution request for <strong>${institutionName}</strong> has been <strong>${newStatus}</strong>.</p>
        ${status === 2 ? `<p><strong>Reason for rejection:</strong> ${reason}</p>` : ''}
        <p>If you have any questions, please contact support.</p>
        <p>Best Regards,<br>Your Team</p>
    `;

    return { subject, emailBody };
};



export const publicationApprovalEmail = (authorizerName) => {
    return `
        <p>Dear ${authorizerName},</p>
        <p>A new institution has been created and requires your approval:</p>
        <ul>
           
        </ul>
        <p>Please review and approve this institution.</p>
        <p>Best Regards,</p>
        <p>Your Team</p>
    `;
};