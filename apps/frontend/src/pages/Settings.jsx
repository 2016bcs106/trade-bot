import { useState } from 'react'
import moment from 'moment'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowRotateRight, faServer, faCheck } from '@fortawesome/free-solid-svg-icons'
import { db, ref, push } from '../utils/firebase'
import Page from '../components/Page'
import PageHeader from '../components/PageHeader'
import SectionHeader from '../components/SectionHeader'
import { CardList } from '../components/Card'
import ListItem from '../components/ListItem'

export default function Settings() {
  const [updateQueued, setUpdateQueued] = useState(false)

  const handleSystemUpdate = async () => {
    await push(ref(db, 'request_queue'), {
      type: 'system_update',
      payload: {},
      status: 'pending',
      createdAt: moment().utcOffset('+05:30').toISOString(),
    })
    setUpdateQueued(true)
    setTimeout(() => setUpdateQueued(false), 3000)
  }

  return (
    <Page>
      <PageHeader title="Settings" />

      <SectionHeader>General</SectionHeader>
      <CardList>
        <ListItem
          icon={faArrowRotateRight}
          iconColor="var(--color-primary)"
          title="Force Reload"
          subtitle="Clear cache and reload"
          onClick={() => window.location.reload(true)}
          isLast
        />
      </CardList>

      <SectionHeader>System</SectionHeader>
      <CardList>
        <ListItem
          icon={updateQueued ? faCheck : faServer}
          iconColor={updateQueued ? 'var(--color-success)' : '#8e8e93'}
          title="System Update"
          subtitle={updateQueued ? 'Queued — worker will pull & restart' : 'Pull latest code, deploy, restart'}
          onClick={!updateQueued ? handleSystemUpdate : undefined}
          isLast
        />
      </CardList>
    </Page>
  )
}
